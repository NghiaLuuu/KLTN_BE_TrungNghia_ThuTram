const { ScheduleConfig } = require('../models/scheduleConfig.model');

exports.getConfig = async () => {
  // Return the single config document if exists, else null
  const cfg = await ScheduleConfig.findOne();
  return cfg;
};

exports.createConfig = async (data) => {
  // Remove existing and create single config for simplicity
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
      // Update existing config
      Object.assign(existingConfig, configData);
      existingConfig.updatedAt = new Date();
      return await existingConfig.save();
    } else {
      // Create new config
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

  // maxGenerateScheduleMonths removed: generation is quarter-based only

  /**
   * Get configuration with validation
   * @returns {Object} Validated configuration
   */
  async getValidatedConfig() {
    const config = await this.getConfig();
    
    if (!config) {
      throw new Error('Schedule configuration not found. Please initialize configuration first.');
    }

    // Validate required fields
    if (!config.unitDuration || config.unitDuration <= 0) {
      throw new Error('Invalid unit duration in configuration');
    }

    // maxGenerateScheduleMonths removed: no validation needed

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