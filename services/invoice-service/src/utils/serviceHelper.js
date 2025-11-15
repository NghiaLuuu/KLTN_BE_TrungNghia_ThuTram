/**
 * Get service addOn IDs from parent service
 * @param {string} parentServiceId - Parent service ID
 * @returns {Array<string>} Array of serviceAddOn IDs (actually they are still serviceId but represent the addons)
 */
async function getServiceAddOnIds(parentServiceId) {
  if (!parentServiceId) {
    return [];
  }

  try {
    // Direct RabbitMQ call to service-service
    const amqp = require('amqplib');
    const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost:5672');
    const channel = await connection.createChannel();
    const replyQueue = await channel.assertQueue('', { exclusive: true });
    
    const correlationId = `${Date.now()}.${Math.random()}`;
    
    // Service-service expects { method, params } format
    const message = JSON.stringify({
      method: 'getServiceById',
      params: { serviceId: parentServiceId }
    });
    
    const responsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('RPC timeout'));
      }, 10000);
      
      channel.consume(replyQueue.queue, (msg) => {
        if (msg && msg.properties.correlationId === correlationId) {
          clearTimeout(timeout);
          const response = JSON.parse(msg.content.toString());
          channel.close();
          connection.close();
          
          if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve(response.result || response);
          }
        }
      }, { noAck: true });
    });
    
    channel.sendToQueue('service-service_rpc_queue', Buffer.from(message), {
      correlationId,
      replyTo: replyQueue.queue
    });
    
    const service = await responsePromise;
    
    // Extract serviceAddOn IDs
    // Note: serviceAddOns are sub-documents, not separate documents
    // So we can't filter by their IDs directly
    // Instead, we return the parent serviceId to indicate we want all addons of this service
    
    if (service && service.serviceAddOns && Array.isArray(service.serviceAddOns)) {
      console.log(`📦 Service ${parentServiceId} has ${service.serviceAddOns.length} addons`);
      // Since serviceAddOns are embedded, we keep the parent serviceId
      // The aggregation logic needs to be aware of this
      return {
        parentServiceId,
        hasAddOns: true,
        addOnCount: service.serviceAddOns.length,
        addOns: service.serviceAddOns.map(addon => ({
          _id: addon._id?.toString(),
          name: addon.name,
          price: addon.price
        }))
      };
    }
    
    return {
      parentServiceId,
      hasAddOns: false,
      addOnCount: 0,
      addOns: []
    };
  } catch (error) {
    console.error('❌ Error fetching service addons:', error.message);
    return {
      parentServiceId,
      hasAddOns: false,
      addOnCount: 0,
      addOns: [],
      error: error.message
    };
  }
}

module.exports = {
  getServiceAddOnIds
};
