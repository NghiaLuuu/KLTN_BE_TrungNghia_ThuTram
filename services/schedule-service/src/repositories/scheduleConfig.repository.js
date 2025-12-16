const { ScheduleConfig } = require('../models/scheduleConfig.model');

exports.getConfig = async () => {
  // Trả về tài liệu cấu hình đơn nếu tồn tại, nếu không trả null
  const cfg = await ScheduleConfig.findOne();
  return cfg;
};

exports.createConfig = async (data) => {
  // Xóa cái cũ và tạo cấu hình đơn để đơn giản
  await ScheduleConfig.deleteMany({});
  const cfg = new ScheduleConfig(data);
  return await cfg.save();
};

exports.updateConfig = async (id, data) => {
  const cfg = await ScheduleConfig.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  if (!cfg) throw new Error('Không tìm thấy cấu hình');
  return cfg;
};
// Note: ScheduleConfig already imported above

class ScheduleConfigRepository {
  /**
   * Get the singleton schedule configuration
   * @returns {Object} Schedule configuration
   */
  async getConfig() {
    return await ScheduleConfig.findOne({});
  }

  /**
   * Create or update schedule configuration (singleton pattern)
   * @param {Object} configData - Configuration data
   * @returns {Object} Created/updated configuration
   */
  async createOrUpdateConfig(configData) {
    const existingConfig = await ScheduleConfig.findOne({});
    
    if (existingConfig) {
      // Cập nhật cấu hình hiện có
      Object.assign(existingConfig, configData);
      existingConfig.updatedAt = new Date();
      return await existingConfig.save();
    } else {
      // Tạo cấu hình mới
      return await ScheduleConfig.create(configData);
    }
  }

  /**
   * Update specific configuration fields
   * @param {Object} updates - Fields to update
   * @returns {Object} Updated configuration
   */
  async updateConfig(updates) {
    const config = await ScheduleConfig.findOne({});
    
    if (!config) {
      throw new Error('Schedule configuration not found. Please create configuration first.');
    }

    Object.assign(config, updates);
    config.updatedAt = new Date();
    return await config.save();
  }

  /**
   * Delete the configuration (rarely used)
   * @returns {Object} Deletion result
   */
  async deleteConfig() {
    return await ScheduleConfig.deleteOne({});
  }

  /**
   * Check if configuration exists
   * @returns {boolean} True if configuration exists
   */
  async configExists() {
    const count = await ScheduleConfig.countDocuments({});
    return count > 0;
  }

  /**
   * Get specific configuration field
   * @param {string} fieldName - Name of the field to retrieve
   * @returns {any} Field value
   */
  async getConfigField(fieldName) {
    const config = await ScheduleConfig.findOne({}).select(fieldName);
    return config ? config[fieldName] : null;
  }

  /**
   * Update auto mode setting
   * @param {boolean} autoMode - Auto mode value
   * @returns {Object} Updated configuration
   */
  async updateAutoMode(autoMode) {
    return await this.updateConfig({ autoMode });
  }

  /**
   * Update unit duration
   * @param {number} unitDuration - Unit duration in minutes
   * @returns {Object} Updated configuration
   */
  async updateUnitDuration(unitDuration) {
    return await this.updateConfig({ unitDuration });
  }

  // maxGenerateScheduleMonths đã xóa: việc tạo lịch chỉ dựa trên quý

  /**
   * Get configuration with validation
   * @returns {Object} Validated configuration
   */
  async getValidatedConfig() {
    const config = await this.getConfig();
    
    if (!config) {
      throw new Error('Schedule configuration not found. Please initialize configuration first.');
    }

    // Kiểm tra các trường bắt buộc
    if (!config.unitDuration || config.unitDuration <= 0) {
      throw new Error('Invalid unit duration in configuration');
    }

    // maxGenerateScheduleMonths đã xóa: không cần kiểm tra

    return config;
  }

  /**
   * Initialize default configuration
   * @returns {Object} Default configuration
   */
  async initializeDefaultConfig() {
    const defaultConfig = {
      unitDuration: 30,
      autoMode: true,
      quarterlyGeneration: {
        enabled: true,
        rollingHorizonMonths: 6
      },
      slotGeneration: {
        bufferMinutesBeforeEnd: 5,
        allowOvernight: true
      }
    };

    return await this.createOrUpdateConfig(defaultConfig);
  }
}

module.exports = new ScheduleConfigRepository();