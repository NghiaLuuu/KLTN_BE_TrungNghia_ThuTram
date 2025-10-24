const Appointment = require('../models/appointment.model');
const { getIO } = require('../utils/socket');

class QueueService {
  /**
   * Get queue for all rooms or specific room
   * @param {String} roomId - Optional room ID filter
   * @returns {Array} Queue data grouped by room
   */
  async getQueue(roomId = null) {
    try {
      const query = {
        status: { $in: ['checked-in', 'in-progress'] },
        appointmentDate: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0)),
          $lte: new Date(new Date().setHours(23, 59, 59, 999))
        }
      };

      if (roomId) {
        query.roomId = roomId;
      }

      const appointments = await Appointment.find(query)
        .sort({ roomId: 1, startTime: 1 })
        .lean();

      // Group by room
      const queueByRoom = {};
      
      appointments.forEach(apt => {
        const roomKey = apt.roomId.toString();
        
        if (!queueByRoom[roomKey]) {
          queueByRoom[roomKey] = {
            roomId: apt.roomId,
            roomName: apt.roomName || 'Phòng khám',
            currentPatient: null,
            waitingList: [],
            totalWaiting: 0
          };
        }

        if (apt.status === 'in-progress') {
          queueByRoom[roomKey].currentPatient = this._formatAppointment(apt);
        } else if (apt.status === 'checked-in') {
          queueByRoom[roomKey].waitingList.push(this._formatAppointment(apt));
        }
      });

      // Calculate totalWaiting
      Object.values(queueByRoom).forEach(room => {
        room.totalWaiting = room.waitingList.length;
      });

      return Object.values(queueByRoom);
    } catch (error) {
      console.error('❌ [QueueService] getQueue error:', error);
      throw error;
    }
  }

  /**
   * Auto-activate next patient when current one completes
   * Called after appointment is marked as completed
   * @param {String} completedAppointmentId - ID of completed appointment
   */
  async activateNextPatient(completedAppointmentId) {
    try {
      const completedApt = await Appointment.findById(completedAppointmentId);
      
      if (!completedApt) {
        console.warn('⚠️ [QueueService] Completed appointment not found');
        return null;
      }

      const roomId = completedApt.roomId;
      const now = new Date();

      console.log(`🔄 [QueueService] Looking for next patient in room ${completedApt.roomName || roomId}`);

      // Find next checked-in patient in same room, sorted by startTime
      const nextPatient = await Appointment.findOne({
        roomId: roomId,
        status: 'checked-in',
        appointmentDate: {
          $gte: new Date(now.setHours(0, 0, 0, 0)),
          $lte: new Date(now.setHours(23, 59, 59, 999))
        }
      }).sort({ startTime: 1 });

      if (nextPatient) {
        // Activate next patient
        nextPatient.status = 'in-progress';
        nextPatient.actualStartTime = new Date();
        await nextPatient.save();

        console.log(`✅ [QueueService] Activated next patient: ${nextPatient.appointmentCode}`);

        // Emit socket event for realtime update
        this._emitQueueUpdate(roomId);

        return nextPatient;
      } else {
        console.log(`ℹ️ [QueueService] No waiting patient in room ${completedApt.roomName || roomId}`);
        
        // Room is now empty - emit update
        this._emitQueueUpdate(roomId);
        
        return null;
      }
    } catch (error) {
      console.error('❌ [QueueService] activateNextPatient error:', error);
      throw error;
    }
  }

  /**
   * Check and auto-start appointments that reached their start time
   * Should be called periodically (e.g., every minute via cron job)
   */
  async autoStartAppointments() {
    try {
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      console.log(`⏰ [QueueService] Auto-start check at ${currentTime}`);

      // Find checked-in appointments that should start now
      const readyAppointments = await Appointment.find({
        status: 'checked-in',
        appointmentDate: {
          $gte: new Date(now.setHours(0, 0, 0, 0)),
          $lte: new Date(now.setHours(23, 59, 59, 999))
        },
        startTime: { $lte: currentTime }
      }).sort({ roomId: 1, startTime: 1 });

      if (readyAppointments.length === 0) {
        return [];
      }

      console.log(`📋 [QueueService] Found ${readyAppointments.length} appointments ready to start`);

      const activated = [];
      const roomsWithActivePatient = new Set();

      // Group by room to ensure only one patient per room
      for (const apt of readyAppointments) {
        const roomKey = apt.roomId.toString();

        // Check if room already has active patient
        const activeInRoom = await Appointment.findOne({
          roomId: apt.roomId,
          status: 'in-progress'
        });

        if (!activeInRoom && !roomsWithActivePatient.has(roomKey)) {
          // Activate this appointment
          apt.status = 'in-progress';
          apt.actualStartTime = new Date();
          await apt.save();

          activated.push(apt);
          roomsWithActivePatient.add(roomKey);

          console.log(`✅ [QueueService] Auto-started: ${apt.appointmentCode} in ${apt.roomName || roomKey}`);

          // Emit realtime update
          this._emitQueueUpdate(apt.roomId);
        }
      }

      return activated;
    } catch (error) {
      console.error('❌ [QueueService] autoStartAppointments error:', error);
      throw error;
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats() {
    try {
      const today = new Date();
      const stats = await Appointment.aggregate([
        {
          $match: {
            appointmentDate: {
              $gte: new Date(today.setHours(0, 0, 0, 0)),
              $lte: new Date(today.setHours(23, 59, 59, 999))
            }
          }
        },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]);

      const result = {
        total: 0,
        confirmed: 0,
        checkedIn: 0,
        inProgress: 0,
        completed: 0,
        cancelled: 0,
        noShow: 0
      };

      stats.forEach(stat => {
        const status = stat._id;
        const count = stat.count;
        result.total += count;

        switch (status) {
          case 'confirmed':
            result.confirmed = count;
            break;
          case 'checked-in':
            result.checkedIn = count;
            break;
          case 'in-progress':
            result.inProgress = count;
            break;
          case 'completed':
            result.completed = count;
            break;
          case 'cancelled':
            result.cancelled = count;
            break;
          case 'no-show':
            result.noShow = count;
            break;
        }
      });

      return result;
    } catch (error) {
      console.error('❌ [QueueService] getQueueStats error:', error);
      throw error;
    }
  }

  /**
   * Format appointment for queue response
   * @private
   */
  _formatAppointment(apt) {
    return {
      _id: apt._id,
      appointmentCode: apt.appointmentCode,
      patientInfo: apt.patientInfo,
      serviceName: apt.serviceName,
      serviceAddOnName: apt.serviceAddOnName,
      dentistName: apt.dentistName,
      nurseId: apt.nurseId || null,
      nurseName: apt.nurseName || null,
      startTime: apt.startTime,
      endTime: apt.endTime,
      status: apt.status,
      checkedInAt: apt.checkedInAt,
      recordId: apt.examRecordId || null, // Include recordId
      estimatedWaitTime: this._calculateWaitTime(apt)
    };
  }

  /**
   * Calculate estimated wait time
   * @private
   */
  _calculateWaitTime(apt) {
    // Simple estimation based on position and service duration
    // Can be enhanced with ML or historical data
    return apt.serviceDuration || 30; // Default 30 minutes
  }

  /**
   * Emit socket event for queue update
   * @private
   */
  _emitQueueUpdate(roomId) {
    try {
      const io = getIO();
      if (io) {
        io.emit('queue_updated', {
          roomId: roomId.toString(),
          timestamp: new Date()
        });
        console.log(`📡 [QueueService] Emitted queue_updated for room ${roomId}`);
      }
    } catch (error) {
      console.warn('⚠️ [QueueService] Socket emit failed:', error.message);
    }
  }
}

module.exports = new QueueService();
