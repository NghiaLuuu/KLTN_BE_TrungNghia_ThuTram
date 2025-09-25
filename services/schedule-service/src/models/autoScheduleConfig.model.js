const mongoose = require('mongoose');

const autoScheduleConfigSchema = new mongoose.Schema({
  // Chỉ có 1 document duy nhất với _id cố định
  _id: {
    type: String,
    default: 'global_auto_schedule_config'
  },
  
  // Chỉ có 1 trường bật/tắt đơn giản
  enabled: {
    type: Boolean,
    default: true,
    required: true
  },
  
  // Thống kê
  stats: {
    lastAutoRun: {
      type: Date,
      default: null
    },
    
    totalAutoRuns: {
      type: Number,
      default: 0
    },
    
    lastSuccessfulRun: {
      type: Date,
      default: null
    },
    
    lastFailedRun: {
      type: Date,
      default: null
    }
  },
  
  // Ai thay đổi cấu hình lần cuối
  lastModifiedBy: {
    type: String,
    default: null
  }
}, {
  timestamps: true,
  collection: 'autoScheduleConfig'
});

// Đảm bảo chỉ có 1 document duy nhất
autoScheduleConfigSchema.statics.getConfig = async function() {
  let config = await this.findById('global_auto_schedule_config');
  
  if (!config) {
    // Tạo config mặc định nếu chưa có
    config = await this.create({
      _id: 'global_auto_schedule_config',
      enabled: true,
      stats: {
        totalAutoRuns: 0
      }
    });
    console.log('✅ Đã tạo cấu hình auto-schedule mặc định');
  }
  
  return config;
};

// Cập nhật cấu hình
autoScheduleConfigSchema.statics.updateConfig = async function(enabled, modifiedBy = null) {
  const config = await this.getConfig();
  
  config.enabled = enabled;
  config.lastModifiedBy = modifiedBy;
  await config.save();
  
  console.log(`⚙️ Đã ${enabled ? 'bật' : 'tắt'} auto-schedule bởi: ${modifiedBy || 'system'}`);
  return config;
};

// Cập nhật thống kê
autoScheduleConfigSchema.statics.updateStats = async function(type, success = true) {
  const config = await this.getConfig();
  
  config.stats.lastAutoRun = new Date();
  config.stats.totalAutoRuns += 1;
  
  if (success) {
    config.stats.lastSuccessfulRun = new Date();
  } else {
    config.stats.lastFailedRun = new Date();
  }
  
  await config.save();
  return config;
};

module.exports = mongoose.model('AutoScheduleConfig', autoScheduleConfigSchema);