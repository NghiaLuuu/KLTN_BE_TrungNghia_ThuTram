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
      // ✅ Convert to ObjectId if it's a string
      const mongoose = require('mongoose');
      query.dentistId = mongoose.Types.ObjectId.isValid(filters.dentistId) 
        ? new mongoose.Types.ObjectId(filters.dentistId)
        : filters.dentistId;
      console.log('🔍 [REPO] dentistId filter:', query.dentistId);
    }

    // 🔒 Nurse filter: Need to find appointments with this nurseId first
    if (filters.nurseId) {
      try {
        const axios = require('axios');
        const APPOINTMENT_SERVICE_URL = process.env.APPOINTMENT_SERVICE_URL || 'http://localhost:3008';
        
        // Get appointments where nurse is assigned
        const response = await axios.get(`${APPOINTMENT_SERVICE_URL}/api/appointment`, {
          params: { nurseId: filters.nurseId }
        });

        if (response.data.success && response.data.data.appointments) {
          const appointmentIds = response.data.data.appointments.map(apt => apt._id);
          
          if (appointmentIds.length > 0) {
            query.appointmentId = { $in: appointmentIds };
          } else {
            // No appointments found for this nurse, return empty
            return [];
          }
        } else {
          return [];
        }
      } catch (error) {
        console.error('Failed to fetch nurse appointments:', error.message);
        return [];
      }
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

    console.log('🔍 [REPO] Final MongoDB query:', JSON.stringify(query, null, 2));

    const results = await Record.find(query)
      .sort({ createdAt: -1 });
    
    console.log('📊 [REPO] Found records:', results.length);
    
    return results;
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
    const updatePayload = {
      status,
      lastModifiedBy: modifiedBy
    };

    if (status === 'in_progress') {
      updatePayload.startedAt = new Date();
    }

    if (status === 'completed') {
      updatePayload.completedAt = new Date();
      updatePayload.hasBeenUsed = true;
    }

    return await Record.findByIdAndUpdate(
      id,
      updatePayload,
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
