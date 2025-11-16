const rabbitmqClient = require('../utils/rabbitmq.client');
const serviceRepository = require('../repositories/service.repository');
const redis = require('../utils/redis.client');

/**
 * Start consuming messages from service_queue
 */
async function startConsumer() {
  try {
    await rabbitmqClient.consumeFromQueue('service_queue', async (message) => {
      console.log('📥 [Service Consumer] Received event:', {
        event: message.event,
        timestamp: new Date().toISOString()
      });

      if (message.event === 'service.mark_as_used') {
        const { services, reservationId, paymentId } = message.data;

        console.log('🔄 [Service Consumer] Processing mark_as_used:', {
          servicesCount: services?.length || 0,
          reservationId,
          paymentId
        });

        // 🔍 DEBUG: Log full event data
        console.log('🔍 [Service Consumer] Full event data:', {
          services: JSON.stringify(services, null, 2),
          reservationId,
          paymentId
        });

        if (!services || !Array.isArray(services) || services.length === 0) {
          console.warn('⚠️ [Service Consumer] No services provided, skipping...');
          return;
        }

        try {
          let updatedCount = 0;

          // Process each service with its addOn
          for (const svc of services) {
            const { serviceId, serviceAddOnId } = svc;

            console.log('🔍 [Service Consumer] Processing service:', {
              serviceId,
              serviceAddOnId: serviceAddOnId || 'none',
              hasServiceId: !!serviceId,
              hasServiceAddOnId: !!serviceAddOnId
            });

            if (!serviceId) {
              console.warn('⚠️ [Service Consumer] Service missing serviceId, skipping:', svc);
              continue;
            }

            if (serviceAddOnId) {
              // Mark both service and specific addOn as used
              console.log(`� [Service Consumer] Marking service ${serviceId} and addOn ${serviceAddOnId}`);
              
              const result = await serviceRepository.markServiceAddOnAsUsed(serviceId, serviceAddOnId);
              
              if (result) {
                updatedCount++;
                console.log(`✅ [Service Consumer] Successfully updated:`, {
                  serviceId: result._id.toString(),
                  serviceName: result.name,
                  serviceHasBeenUsed: result.hasBeenUsed,
                  updatedAddOn: result.serviceAddOns?.find(a => a._id.toString() === serviceAddOnId)
                });
              } else {
                console.warn(`⚠️ [Service Consumer] No result returned for service ${serviceId} with addOn ${serviceAddOnId}`);
              }
            } else {
              // Mark only service as used (no addOn selected)
              console.log(`� [Service Consumer] Marking service ${serviceId} (no addOn)`);
              const result = await serviceRepository.markServicesAsUsed([serviceId]);
              if (result.modifiedCount > 0) {
                updatedCount++;
                console.log(`✅ [Service Consumer] Updated service ${serviceId}`);
              }
            }
          }

          console.log('✅ [Service Consumer] Database updated:', {
            totalProcessed: services.length,
            successfullyUpdated: updatedCount
          });

          // Refresh cache
          try {
            const allServices = await serviceRepository.listServices(0, 1000);
            await redis.set('services_cache', JSON.stringify(allServices), { EX: 3600 });
            console.log('✅ [Service Consumer] Cache refreshed');
          } catch (cacheError) {
            console.error('⚠️ [Service Consumer] Cache refresh failed:', cacheError.message);
            // Don't throw - main task completed
          }

          console.log('✅ [Service Consumer] All services marked as used successfully');
        } catch (error) {
          console.error('❌ [Service Consumer] Error marking services as used:', {
            error: error.message,
            services,
            reservationId
          });
          throw error; // Will trigger RabbitMQ retry mechanism
        }
      } else {
        console.log('ℹ️ [Service Consumer] Unhandled event type:', message.event);
      }
    });

    console.log('👂 [Service Consumer] Listening to service_queue...');
  } catch (error) {
    console.error('❌ [Service Consumer] Failed to start consumer:', error);
    throw error;
  }
}

module.exports = { startConsumer };
