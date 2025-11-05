const OpenAI = require('openai');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || ''
});

// OpenAI configuration
const config = {
  model: process.env.OPENAI_MODEL || 'gpt-4o',
  visionModel: process.env.OPENAI_VISION_MODEL || 'gpt-4o',
  temperature: parseFloat(process.env.TEMPERATURE) || 0.7,
  maxTokens: parseInt(process.env.MAX_TOKENS) || 2000
};

module.exports = {
  openai,
  config
};
