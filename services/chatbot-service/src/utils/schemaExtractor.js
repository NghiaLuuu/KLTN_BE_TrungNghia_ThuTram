/**
 * 🗄️ Bộ trích xuất Schema - Trích xuất Mongoose schemas cho AI Query Engine
 * 
 * Trích xuất thông tin schema từ các Mongoose model để giúp GPT hiểu
 * cấu trúc dữ liệu và tạo các MongoDB query chính xác hơn.
 */

const mongoose = require('mongoose');

/**
 * Trích xuất các trường schema từ Mongoose model
 * @param {mongoose.Model} model - Mongoose model
 * @returns {Object} Thông tin schema
 */
function extractSchemaFields(model) {
  const schema = model.schema;
  const paths = schema.paths;
  const fields = {};

  Object.keys(paths).forEach(key => {
    // Bỏ qua các trường nội bộ
    if (key === '_id' || key === '__v') return;

    const path = paths[key];
    const fieldInfo = {
      type: path.instance,
      required: path.isRequired || false
    };

    // Thêm các giá trị enum nếu có
    if (path.enumValues && path.enumValues.length > 0) {
      fieldInfo.enum = path.enumValues;
    }

    // Thêm ref nếu là tham chiếu
    if (path.options && path.options.ref) {
      fieldInfo.ref = path.options.ref;
    }

    // Thêm mô tả nếu có
    if (path.options && path.options.description) {
      fieldInfo.description = path.options.description;
    }

    fields[key] = fieldInfo;
  });

  return fields;
}

/**
 * Lấy tất cả collections có sẵn với schemas của chúng
 * @returns {Object} Map tên collection sang thông tin schema
 */
function getAllSchemas() {
  const schemas = {};
  const modelNames = mongoose.modelNames();

  modelNames.forEach(modelName => {
    try {
      const model = mongoose.model(modelName);
      const collectionName = model.collection.name;
      
      schemas[collectionName] = {
        modelName,
        collectionName,
        fields: extractSchemaFields(model)
      };
    } catch (error) {
      console.warn(`⚠️ Could not extract schema for model: ${modelName}`);
    }
  });

  return schemas;
}

/**
 * Định dạng schemas cho GPT prompt
 * @param {Array<string>} collectionNames - Các collections cần bao gồm (tùy chọn, bao gồm tất cả nếu rỗng)
 * @returns {string} Mô tả schema đã định dạng
 */
function formatSchemasForPrompt(collectionNames = []) {
  const allSchemas = getAllSchemas();
  let formatted = 'CẤU TRÚC DATABASE CHI TIẾT:\n\n';

  const schemasToInclude = collectionNames.length > 0
    ? Object.keys(allSchemas).filter(name => collectionNames.includes(name))
    : Object.keys(allSchemas);

  schemasToInclude.forEach(collectionName => {
    const schema = allSchemas[collectionName];
    formatted += `📁 Collection: "${collectionName}" (Model: ${schema.modelName})\n`;
    formatted += 'Fields:\n';

    Object.keys(schema.fields).forEach(fieldName => {
      const field = schema.fields[fieldName];
      let fieldDesc = `  - ${fieldName}: ${field.type}`;
      
      if (field.required) {
        fieldDesc += ' (required)';
      }
      
      if (field.enum) {
        fieldDesc += ` [enum: ${field.enum.join(', ')}]`;
      }
      
      if (field.ref) {
        fieldDesc += ` → ref: ${field.ref}`;
      }
      
      if (field.description) {
        fieldDesc += ` // ${field.description}`;
      }
      
      formatted += fieldDesc + '\n';
    });
    
    formatted += '\n';
  });

  return formatted;
}

/**
 * Lấy thông tin schema cho các collections cụ thể
 * @param {Array<string>} collectionNames - Mảng tên collections
 * @returns {Object} Thông tin schema cho các collections đã chỉ định
 */
function getSchemasForCollections(collectionNames) {
  const allSchemas = getAllSchemas();
  const result = {};

  collectionNames.forEach(name => {
    if (allSchemas[name]) {
      result[name] = allSchemas[name];
    }
  });

  return result;
}

/**
 * Tạo các query ví dụ cho collection dựa trên schema của nó
 * @param {string} collectionName - Tên collection
 * @returns {Array<Object>} Các query ví dụ
 */
function generateExampleQueries(collectionName) {
  const allSchemas = getAllSchemas();
  const schema = allSchemas[collectionName];
  
  if (!schema) {
    return [];
  }

  const examples = [];
  const fields = schema.fields;

  // Generate examples based on field types
  Object.keys(fields).forEach(fieldName => {
    const field = fields[fieldName];

    // String fields with enum
    if (field.type === 'String' && field.enum) {
      examples.push({
        description: `Tìm theo ${fieldName}`,
        filter: { [fieldName]: field.enum[0] }
      });
    }

    // Boolean fields
    if (field.type === 'Boolean') {
      examples.push({
        description: `Tìm ${fieldName} = true`,
        filter: { [fieldName]: true }
      });
    }

    // Date fields
    if (field.type === 'Date') {
      examples.push({
        description: `Tìm theo ${fieldName}`,
        filter: { [fieldName]: { $gte: '2025-11-01' } }
      });
    }
  });

// Giới hạn 3 ví dụ
  return examples.slice(0, 3);
}

/**
 * Tạo system prompt nâng cao với thông tin schema
 * @param {Array<string>} whitelistedCollections - Các collections được phép query
 * @returns {string} System prompt nâng cao
 */
function createSchemaAwarePrompt(whitelistedCollections = ['slots', 'rooms', 'services', 'users']) {
  const schemaInfo = formatSchemasForPrompt(whitelistedCollections);
  
  const prompt = `Bạn là một chuyên gia MongoDB cho hệ thống PHÒNG KHÁM NHA KHOA. Nhiệm vụ của bạn là chuyển đổi câu hỏi tiếng Việt thành MongoDB query.

🏥 CONTEXT: Đây là hệ thống PHÒNG KHÁM NHA KHOA
- Tất cả "services" đều là dịch vụ nha khoa (tẩy trắng, niềng răng, trám răng...)
- Tất cả "users" với roles=DENTIST đều là nha sĩ
- Tất cả "rooms" đều là phòng trong phòng khám nha khoa
- Tất cả "slots" đều là lịch khám nha khoa

${schemaInfo}

QUAN TRỌNG:
- Chỉ trả về JSON hợp lệ với 2 trường: "collection" và "filter"
- Collection phải là một trong: ${whitelistedCollections.join(', ')}
- Filter phải là MongoDB query object hợp lệ dựa trên ĐÚNG CẤU TRÚC SCHEMA ở trên
- Chỉ sử dụng các FIELD CÓ TRONG SCHEMA
- Chú ý các trường có enum - chỉ dùng giá trị trong danh sách enum
- Chỉ sử dụng các toán tử an toàn như: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $and, $or, $regex
- KHÔNG sử dụng: $where, $function, delete, update, drop, insert

🎯 QUY TẮC HIỂU CÂU HỎI (QUAN TRỌNG):
- "Dịch vụ nha khoa" / "Các dịch vụ" → Lấy TẤT CẢ services (không cần filter category)
- "Dịch vụ tẩy trắng" → Filter theo name với $regex
- "Nha sĩ" → Filter users với roles=DENTIST
- "Phòng khám" / "Phòng" → Lấy từ collection rooms
- "Lịch trống" / "Slot trống" → Filter slots với isAvailable=true

VÍ DỤ CỤ THỂ THEO SCHEMA:

Collection: services
- Câu hỏi: "Danh sách dịch vụ nha khoa" / "Có những dịch vụ gì?"
- Query: {"collection": "services", "filter": {"isActive": true}}
- ⚠️ KHÔNG filter theo category vì TẤT CẢ services đều là dịch vụ nha khoa

- Câu hỏi: "Dịch vụ tẩy trắng răng"
- Query: {"collection": "services", "filter": {"name": {"$regex": "tẩy trắng", "$options": "i"}, "isActive": true}}

Collection: slots
- Câu hỏi: "Tìm slot trống ngày 7/11/2025"
- Query: {"collection": "slots", "filter": {"date": "2025-11-07", "isAvailable": true}}

Collection: rooms
- Câu hỏi: "Phòng X-quang đang hoạt động"
- Query: {"collection": "rooms", "filter": {"roomType": "X_RAY", "isActive": true}}

Collection: users
- Câu hỏi: "Nha sĩ chuyên nha chu"
- Query: {"collection": "users", "filter": {"roles": {"$in": ["DENTIST"]}, "specialization": {"$regex": "nha chu", "$options": "i"}}}

LƯU Ý KHI TẠO FILTER:
- Với String search: dùng $regex với $options: "i" (case-insensitive)
- Với enum fields: chỉ dùng giá trị CHÍNH XÁC trong enum
- Với Boolean: dùng true/false
- Với Date: dùng format "YYYY-MM-DD"
- Với Array fields (như roles): dùng $in: [value]

Chỉ trả về JSON, không giải thích gì thêm.`;

  return prompt;
}

module.exports = {
  extractSchemaFields,
  getAllSchemas,
  formatSchemasForPrompt,
  getSchemasForCollections,
  generateExampleQueries,
  createSchemaAwarePrompt
};
