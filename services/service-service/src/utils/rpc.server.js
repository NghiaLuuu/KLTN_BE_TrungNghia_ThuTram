/**
 * RPC Server for Service Service
 * Handles incoming RPC requests from other microservices
 */

const serviceService = require('../services/service.service');

let channel = null;

/**
 * Initialize RPC Server
 */
async function initRpcServer(rabbitmqChannel) {
  channel = rabbitmqChannel;
  
  // Create RPC queue for service-service (format: rpc.service-name)
  const rpcQueue = 'rpc.service-service';
  await channel.assertQueue(rpcQueue, { durable: true });
  
  console.log(`👂 [RPC Server] Listening on queue: ${rpcQueue}`);
  
  // Consume RPC requests
  channel.consume(rpcQueue, async (msg) => {
    if (!msg) return;
    
    try {
      const request = JSON.parse(msg.content.toString());
      console.log(`📥 [RPC Server] Received request:`, {
        method: request.method,
        params: request.params
      });
      
      let response = null;
      
      // Handle different RPC methods
      switch (request.method) {
        case 'getServiceAddOn':
          response = await handleGetServiceAddOn(request.params);
          break;
          
        case 'getService':
          response = await handleGetService(request.params);
          break;
          
        default:
          throw new Error(`Unknown RPC method: ${request.method}`);
      }
      
      // Send response back
      channel.sendToQueue(
        msg.properties.replyTo,
        Buffer.from(JSON.stringify(response)),
        { correlationId: msg.properties.correlationId }
      );
      
      channel.ack(msg);
      console.log(`✅ [RPC Server] Response sent for ${request.method}`);
      
    } catch (error) {
      console.error(`❌ [RPC Server] Error processing request:`, error);
      
      // Send error response (RPC client checks for data.error)
      const errorResponse = {
        error: error.message
      };
      
      channel.sendToQueue(
        msg.properties.replyTo,
        Buffer.from(JSON.stringify(errorResponse)),
        { correlationId: msg.properties.correlationId }
      );
      
      channel.ack(msg);
    }
  });
}

/**
 * Handle getServiceAddOn RPC request
 */
async function handleGetServiceAddOn({ serviceId, serviceAddOnId }) {
  try {
    console.log(`🔍 [RPC Handler] getServiceAddOn:`, { serviceId, serviceAddOnId });
    
    const result = await serviceService.getServiceAddOnById(serviceId, serviceAddOnId);
    
    if (!result) {
      throw new Error('Service or ServiceAddOn not found');
    }
    
    console.log(`✅ [RPC Handler] getServiceAddOn result:`, {
      serviceName: result.service?.name,
      serviceType: result.service?.type, // ⭐ Service model uses 'type' field
      addOnName: result.addOn?.name,
      addOnDuration: result.addOn?.durationMinutes || result.addOn?.duration // ⭐ ServiceAddOn uses 'durationMinutes'
    });
    
    // Return format that RPC client expects: { result: { service, addOn } }
    return {
      result: result
    };
  } catch (error) {
    console.error(`❌ [RPC Handler] getServiceAddOn error:`, error);
    throw error;
  }
}

/**
 * Handle getService RPC request
 */
async function handleGetService({ serviceId }) {
  try {
    console.log(`🔍 [RPC Handler] getService:`, { serviceId });
    
    const service = await serviceService.getServiceById(serviceId);
    
    if (!service) {
      throw new Error('Service not found');
    }
    
    // ✅ Return consistent format: { service: ... }
    return {
      service: service
    };
  } catch (error) {
    console.error(`❌ [RPC Handler] getService error:`, error);
    throw error;
  }
}

module.exports = {
  initRpcServer
};
