const Record = require("../models/record.model");

class RecordRepository {
  async create(data) {
    const record = new Record(data);
    return await record.save();
  }

  async findById(id) {
    // ✅ Không populate - hồ sơ đã có sẵn patientInfo & dentistName
    return await Record.findById(id);
  }

  async findAll(filters = {}) {
    const query = {};
    
    if (filters.patientId) {
      query.patientId = filters.patientId;
    }
    
    if (filters.dentistId) {
      // ✅ Chuyển đổi sang ObjectId nếu là chuỗi
      const mongoose = require('mongoose');
      query.dentistId = mongoose.Types.ObjectId.isValid(filters.dentistId) 
        ? new mongoose.Types.ObjectId(filters.dentistId)
        : filters.dentistId;
      // console.log('🔍 [REPO] dentistId filter:', query.dentistId);
    }

    // 🔒 Bộ lọc Nurse: Cần tìm các cuộc hẹn có nurseId này trước
    if (filters.nurseId) {
      try {
        const axios = require('axios');
        const APPOINTMENT_SERVICE_URL = process.env.APPOINTMENT_SERVICE_URL || 'http://localhost:3006';
        
        // Lấy các cuộc hẹn mà nurse được phân công
        const response = await axios.get(`${APPOINTMENT_SERVICE_URL}/api/appointments`, {
          params: { nurseId: filters.nurseId }
        });

        if (response.data.success && response.data.data.appointments) {
          const appointmentIds = response.data.data.appointments.map(apt => apt._id);
          
          if (appointmentIds.length > 0) {
            query.appointmentId = { $in: appointmentIds };
          } else {
            // Không tìm thấy cuộc hẹn nào cho nurse này, trả về rỗng
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

    // console.log('🔍 [REPO] Final MongoDB query:', JSON.stringify(query, null, 2));

    const results = await Record.find(query)
      .sort({ createdAt: -1 });
    
    // console.log('📊 [REPO] Found records:', results.length);
    // console.log('🔍 [DEBUG] About to populate appointment times...');
    
    // 🕐 Populate thời gian cuộc hẹn (startTime & endTime)
    if (results.length > 0) {
      // console.log('🔍 [DEBUG] results.length > 0, proceeding...');
      try {
        const axios = require('axios');
        const APPOINTMENT_SERVICE_URL = process.env.APPOINTMENT_SERVICE_URL || 'http://localhost:3006';
        
        // Lấy các appointmentIds duy nhất
        const appointmentIds = results
          .filter(r => r.appointmentId)
          .map(r => r.appointmentId.toString())
          .filter((id, index, self) => self.indexOf(id) === index); // unique
        
        if (appointmentIds.length > 0) {
          // console.log('🕐 Fetching appointment times for', appointmentIds.length, 'appointments');
          // console.log('🕐 Appointment IDs:', appointmentIds);
          // console.log('🕐 URL:', `${APPOINTMENT_SERVICE_URL}/api/appointment/by-ids`);
          
          // Lấy các cuộc hẹn theo batch
          const response = await axios.get(`${APPOINTMENT_SERVICE_URL}/api/appointments/by-ids`, {
            params: { ids: appointmentIds.join(',') }
          });
          
          // console.log('🕐 Response status:', response.status);
          // console.log('🕐 Response data:', JSON.stringify(response.data, null, 2));
          
          if (response.data.success && response.data.data) {
            const appointmentsMap = {};
            response.data.data.forEach(apt => {
              appointmentsMap[apt._id.toString()] = {
                startTime: apt.startTime,
                endTime: apt.endTime,
                bookingChannel: apt.bookingChannel, // online hoặc walk-in
                deposit: apt.deposit || 0, // Tiền cọc (nếu có)
                paymentStatus: apt.paymentStatus // pending, paid, v.v.
              };
            });
            
            // console.log('🕐 Appointments map:', JSON.stringify(appointmentsMap, null, 2));
            
            // Thêm thời gian vào hồ sơ
            results.forEach(record => {
              if (record.appointmentId) {
                const aptData = appointmentsMap[record.appointmentId.toString()];
                if (aptData) {
                  record._doc.appointmentStartTime = aptData.startTime;
                  record._doc.appointmentEndTime = aptData.endTime;
                  record._doc.appointmentBookingChannel = aptData.bookingChannel;
                  record._doc.appointmentDeposit = aptData.deposit;
                  record._doc.appointmentPaymentStatus = aptData.paymentStatus;
                  // console.log(`✅ Added appointment data to record ${record.recordCode}:`, {
                  //   time: `${aptData.startTime} - ${aptData.endTime}`,
                  //   channel: aptData.bookingChannel,
                  //   deposit: aptData.deposit
                  // });
                }
              }
            });
            
            // console.log('✅ Added appointment times to records');
          }
        } else {
          // console.log('ℹ️ No records with appointmentId found');
        }
      } catch (error) {
        console.error('⚠️ Failed to fetch appointment times:', error.message);
        if (error.response) {
          console.error('⚠️ Error response:', error.response.status, error.response.data);
        }
        // Don't throw - just continue without times
      }
    }
    
    return results;
  }

  async update(id, data) {
    // ✅ Loại bỏ prescription khỏi update để tránh validation conflict
    // Prescription chỉ được update qua endpoint riêng addPrescription
    const { prescription, ...updateData } = data;
    
    // ✅ Sử dụng $set để chỉ update các trường cụ thể, không touch prescription
    return await Record.findByIdAndUpdate(
      id, 
      { 
        $set: { 
          ...updateData, 
          lastModifiedBy: updateData.modifiedBy 
        } 
      },
      { 
        new: true, 
        runValidators: false, // ✅ Tắt validator
        strict: false // ✅ Cho phép update mà không validate toàn bộ schema
      }
    );
  }

  async delete(id) {
    const record = await Record.findById(id);
    if (!record) {
      throw new Error('Không tìm thấy hồ sơ');
    }

    if (record.hasBeenUsed) {
      throw new Error('Không thể xóa hồ sơ đã được sử dụng');
    }

    return await Record.findByIdAndDelete(id);
  }

  async findByPatient(patientId, limit = 10) {
    // ✅ Không populate - hồ sơ đã có sẵn dentistName & patientInfo
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
    
    // ✅ Không populate - hồ sơ đã có sẵn patientInfo & dentistName
    return await Record.find(query)
      .sort({ date: -1 });
  }

  async findByRecordCode(recordCode) {
    // ✅ Không populate - hồ sơ đã có sẵn patientInfo & dentistName
    return await Record.findOne({ recordCode });
  }

  async findPending() {
    // ✅ Không populate - hồ sơ đã có sẵn patientInfo & dentistName
    return await Record.find({ status: 'pending' })
      .sort({ priority: -1, createdAt: 1 });
  }

  async updateStatus(id, status, modifiedBy) {
    const updatePayload = {
      status,
      lastModifiedBy: modifiedBy
    };

    if (status === 'in-progress') {
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
    // ✅ Không cần filter, chấp nhận tất cả medicines kể cả chưa đầy đủ thông tin
    const prescriptionData = {
      medicines: prescription?.medicines || [],
      notes: prescription?.notes || '',
      prescribedBy,  // ✅ Always use the prescribedBy from parameter
      prescribedAt: new Date()
    };
    
    console.log('💊 Saving prescription with', prescriptionData.medicines.length, 'medicines');
    
    return await Record.findByIdAndUpdate(
      id,
      { 
        $set: {
          prescription: prescriptionData,
          lastModifiedBy: prescribedBy
        }
      },
      { 
        new: true, 
        runValidators: false, // ✅ Tắt validator
        strict: false
      }
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
