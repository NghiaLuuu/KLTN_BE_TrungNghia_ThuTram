const Record = require("../models/record.model");

class RecordRepository {
  async create(data) {
    const record = new Record(data);
    return await record.save();
  }

  async findById(id) {
    // ✅ Don't populate - record already has patientInfo & dentistName
    return await Record.findById(id);
  }

  async findAll(filters = {}) {
    const query = {};
    
    if (filters.patientId) {
      query.patientId = filters.patientId;
    }
    
    if (filters.dentistId) {
      query.dentistId = filters.dentistId;
    }
    
    if (filters.status) {
      query.status = filters.status;
    }
    
    if (filters.type) {
      query.type = filters.type;
    }
    
    if (filters.dateFrom && filters.dateTo) {
      query.date = {
        $gte: new Date(filters.dateFrom),
        $lte: new Date(filters.dateTo)
      };
    }
    
    if (filters.search) {
      query.$or = [
        { recordCode: { $regex: filters.search, $options: 'i' } },
        { 'patientInfo.name': { $regex: filters.search, $options: 'i' } },
        { 'patientInfo.phone': { $regex: filters.search, $options: 'i' } },
        { diagnosis: { $regex: filters.search, $options: 'i' } }
      ];
    }

    return await Record.find(query)
      .sort({ createdAt: -1 });
  }

  async update(id, data) {
    // ✅ Don't populate - record already has patientInfo & dentistName
    return await Record.findByIdAndUpdate(
      id, 
      { ...data, lastModifiedBy: data.modifiedBy },
      { new: true, runValidators: true }
    );
  }

  async delete(id) {
    const record = await Record.findById(id);
    if (!record) {
      throw new Error('Record not found');
    }

    if (record.hasBeenUsed) {
      throw new Error('Không thể xóa hồ sơ đã được sử dụng');
    }

    return await Record.findByIdAndDelete(id);
  }

  async findByPatient(patientId, limit = 10) {
    // ✅ Don't populate - record already has dentistName & patientInfo
    return await Record.find({ patientId })
      .sort({ date: -1 })
      .limit(limit);
  }

  async findByDentist(dentistId, startDate, endDate) {
    const query = { dentistId };
    
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    // ✅ Don't populate - record already has patientInfo & dentistName
    return await Record.find(query)
      .sort({ date: -1 });
  }

  async findByRecordCode(recordCode) {
    // ✅ Don't populate - record already has patientInfo & dentistName
    return await Record.findOne({ recordCode });
  }

  async findPending() {
    // ✅ Don't populate - record already has patientInfo & dentistName
    return await Record.find({ status: 'pending' })
      .sort({ priority: -1, createdAt: 1 });
  }

  async updateStatus(id, status, modifiedBy) {
    return await Record.findByIdAndUpdate(
      id,
      { 
        status,
        lastModifiedBy: modifiedBy,
        ...(status === 'completed' && { hasBeenUsed: true })
      },
      { new: true }
    );
  }

  async addPrescription(id, prescription, prescribedBy) {
    return await Record.findByIdAndUpdate(
      id,
      { 
        prescription: {
          ...prescription,
          prescribedBy,
          prescribedAt: new Date()
        },
        lastModifiedBy: prescribedBy
      },
      { new: true }
    );
  }

  async updateTreatmentIndication(id, indicationId, used, notes, modifiedBy) {
    const record = await Record.findById(id);
    if (!record) {
      throw new Error('Record not found');
    }

    const indication = record.treatmentIndications.id(indicationId);
    if (!indication) {
      throw new Error('Treatment indication not found');
    }

    indication.used = used;
    indication.usedAt = used ? new Date() : null;
    if (notes) indication.notes = notes;

    record.lastModifiedBy = modifiedBy;
    
    return await record.save();
  }

  async getStatistics(startDate, endDate) {
    const matchStage = {};
    
    if (startDate && endDate) {
      matchStage.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const stats = await Record.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          examCount: {
            $sum: { $cond: [{ $eq: ['$type', 'exam'] }, 1, 0] }
          },
          treatmentCount: {
            $sum: { $cond: [{ $eq: ['$type', 'treatment'] }, 1, 0] }
          },
          pendingCount: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          },
          completedCount: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          totalRevenue: { $sum: '$totalCost' }
        }
      }
    ]);

    return stats[0] || {
      total: 0,
      examCount: 0,
      treatmentCount: 0,
      pendingCount: 0,
      completedCount: 0,
      totalRevenue: 0
    };
  }

  async markAsUsed(id) {
    return await Record.findByIdAndUpdate(
      id,
      { hasBeenUsed: true },
      { new: true }
    );
  }
}

module.exports = new RecordRepository();
