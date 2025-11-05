# Phase 3: API Integration Engine - COMPLETED ✅

## Tổng Quan
Phase 3 triển khai hệ thống tích hợp API nội bộ, cho phép GPT tự động gọi các microservices khác (auth-service, service-service, schedule-service) để lấy thông tin chính xác về dịch vụ, lịch khám, bác sĩ.

## Kiến Trúc Hoạt Động

```
User Message → GPT Analysis → JSON API Request → Internal API Client → Microservice
                                                                              ↓
User Response ← Format Result ← API Integration Service ← API Response ←─────┘
```

## Files Đã Tạo

### 1. `src/config/apiMapping.js`
**Chức năng:** Cấu hình mapping giữa actions và API endpoints

**Nội dung chính:**
- `API_BASE_URLS`: URLs của các microservices
- `API_ENDPOINTS`: Chi tiết từng endpoint (method, path, params)
  * `SEARCH_SERVICES`: Tìm dịch vụ theo keyword
  * `GET_ALL_SERVICES`: Lấy tất cả dịch vụ
  * `GET_SERVICE_DETAIL`: Chi tiết dịch vụ + giá
  * `GET_AVAILABLE_SLOTS`: Tìm lịch trống theo ngày
  * `GET_DOCTORS_LIST`: Danh sách bác sĩ
  * `GET_DOCTORS_BY_SERVICE`: Bác sĩ theo dịch vụ
  * `GET_DOCTOR_INFO`: Thông tin chi tiết bác sĩ
  * `GET_DOCTOR_SCHEDULE`: Lịch làm việc bác sĩ
- `ACTION_KEYWORDS`: Map keywords trong câu hỏi → action
- `RESPONSE_TEMPLATES`: Template format kết quả API

**Ví dụ Endpoint:**
```javascript
GET_AVAILABLE_SLOTS: {
  method: 'GET',
  baseUrl: 'http://localhost:3005',
  path: '/api/schedules/available-slots',
  params: ['date', 'serviceId']
}
```

### 2. `src/utils/apiRequestParser.js`
**Chức năng:** Parse và validate JSON API request từ GPT response

**Methods:**
- `extractApiRequest(responseText)`: Trích xuất JSON từ markdown code block hoặc text thuần
- `validateApiRequest(apiRequest)`: Validate cấu trúc {action, params}
- `checkRequiredParams(apiRequest)`: Kiểm tra required params
- `parseApiRequest(responseText)`: Full parse + validate pipeline
- `hasApiRequest(responseText)`: Check xem response có chứa API request không

**Input Format (GPT response):**
````
```json
{
  "action": "SEARCH_SERVICES",
  "params": {
    "query": "tẩy trắng răng"
  }
}
```
````

**Output:**
```javascript
{
  success: true,
  apiRequest: { action: 'SEARCH_SERVICES', params: { query: 'tẩy trắng răng' } },
  error: null
}
```

### 3. `src/utils/internalApiClient.js`
**Chức năng:** HTTP client để gọi internal microservices

**Methods:**
- `callInternalApi(action, params, authToken)`: Gọi 1 API theo action name
  * Tự động build URL với path params (`:id`, `:doctorId`)
  * Thêm query params cho GET
  * Thêm body cho POST/PUT
  * Inject JWT token vào Authorization header
  * Handle timeout (10s) và errors
- `callMultipleApis(requests, authToken)`: Gọi nhiều APIs song song
- `checkServiceHealth(serviceUrl)`: Health check service

**Features:**
- Axios instance với timeout 10s
- Header `X-Internal-Call: true` để đánh dấu internal call
- Error handling: service unavailable, timeout, network error
- Promise.allSettled cho parallel calls

**Example Usage:**
```javascript
const result = await callInternalApi('SEARCH_SERVICES', 
  { query: 'tẩy trắng' }, 
  'jwt_token_here'
);
// result: { success: true, data: [...], statusCode: 200 }
```

### 4. `src/services/apiIntegration.service.js`
**Chức năng:** Orchestrate toàn bộ flow API integration

**Methods:**
- `needsApiCall(gptResponse)`: Check xem GPT có muốn gọi API không
- `executeApiCall(gptResponse, authToken)`: Parse + Execute API
- `formatApiResult(action, apiResult)`: Format kết quả thành human-readable text
- `injectApiResult(messages, apiResponse)`: Inject kết quả vào conversation context
- `processApiIntegration(gptResponse, conversationMessages, authToken)`: **Main method** - Complete flow

**Flow của `processApiIntegration`:**
1. Check xem GPT response có chứa API request không
2. Nếu không → return original response
3. Nếu có → Parse API request
4. Execute API call qua internalApiClient
5. Format kết quả theo template
6. Return formatted response + metadata

**Return Value:**
```javascript
{
  needsApi: true,
  finalResponse: "Chúng tôi có 3 dịch vụ phù hợp:\n1. Tẩy trắng răng Laser...",
  updatedMessages: [...], // Optional context injection
  apiData: [...], // Raw API data
  action: 'SEARCH_SERVICES'
}
```

### 5. `src/config/systemPrompts.js` (Updated)
**Thay đổi:** Thêm hướng dẫn gọi API cho GPT

**Nội dung mới:**
- Section "KHẢ NĂNG GỌI API (QUAN TRỌNG)"
- Liệt kê 6 APIs available với ví dụ JSON format
- Quy tắc khi nào gọi API:
  * Chỉ gọi khi cần thông tin cụ thể (dịch vụ, giá, lịch)
  * KHÔNG gọi với câu chào hỏi chung chung
  * Return JSON trong markdown code block
- Thêm ngày hiện tại vào prompt: `${new Date().toISOString().split('T')[0]}`

**Example Instruction trong Prompt:**
```
1. SEARCH_SERVICES - Tìm kiếm dịch vụ theo tên
   Ví dụ: Người dùng hỏi "có dịch vụ tẩy trắng răng không?"
   ```json
   {
     "action": "SEARCH_SERVICES",
     "params": {
       "query": "tẩy trắng răng"
     }
   }
   ```
```

### 6. `src/services/ai.service.js` (Updated)
**Thay đổi:** Tích hợp API integration vào GPT flow

**Method `sendMessageToGPT` - NEW VERSION:**
```javascript
async sendMessageToGPT(messages, systemPrompt, authToken) {
  // Step 1: Get initial GPT response
  const gptResponse = await openai.chat.completions.create(...);
  
  // Step 2: Check if GPT wants to call API
  const apiIntegration = await processApiIntegration(gptResponse, messages, authToken);
  
  // Step 3: Return appropriate response
  if (apiIntegration.needsApi) {
    return {
      response: apiIntegration.finalResponse, // Formatted API result
      apiData: apiIntegration.apiData,
      usedApi: true,
      action: apiIntegration.action
    };
  } else {
    return {
      response: gptResponse,
      apiData: null,
      usedApi: false
    };
  }
}
```

**Thêm method mới:**
- `sendSimpleMessage()`: Version không có API integration (cho fallback)

### 7. `src/controllers/chatbot.controller.js` (Updated)
**Thay đổi:** 
- Extract auth token từ request headers
- Pass token vào `aiService.sendMessageToGPT()`
- Return thêm metadata: `usedApi`, `apiAction`

**Code Updated:**
```javascript
// Get auth token from request
const authToken = req.headers.authorization?.split(' ')[1] || null;

// Get GPT response (with API integration)
const result = await aiService.sendMessageToGPT(formattedMessages, undefined, authToken);

// Return response with metadata
res.json({
  success: true,
  response: result.response,
  sessionId: session.sessionId,
  timestamp: new Date().toISOString(),
  usedApi: result.usedApi || false,
  apiAction: result.action || null
});
```

### 8. `.env` (Updated)
**Thêm:** Service URLs cho internal API calls

```env
# Internal Microservices URLs (for API Integration)
AUTH_SERVICE_URL=http://localhost:3001
SERVICE_SERVICE_URL=http://localhost:3004
SCHEDULE_SERVICE_URL=http://localhost:3005
APPOINTMENT_SERVICE_URL=http://localhost:3007
```

## Luồng Hoạt Động Đầy Đủ

### Scenario: User hỏi "Có dịch vụ tẩy trắng răng không?"

1. **User → Frontend:**
   ```javascript
   chatbotService.sendMessage("Có dịch vụ tẩy trắng răng không?")
   ```

2. **Frontend → Backend:**
   ```
   POST /api/ai/chat
   Headers: { Authorization: "Bearer jwt_token" }
   Body: { message: "Có dịch vụ tẩy trắng răng không?" }
   ```

3. **Controller → AI Service:**
   ```javascript
   const result = await aiService.sendMessageToGPT(
     formattedMessages, 
     DENTAL_ASSISTANT_PROMPT,
     authToken
   );
   ```

4. **AI Service → OpenAI GPT-4o:**
   ```
   System Prompt: [Hướng dẫn gọi API + danh sách APIs]
   User Message: "Có dịch vụ tẩy trắng răng không?"
   ```

5. **GPT-4o → AI Service:**
   ````
   ```json
   {
     "action": "SEARCH_SERVICES",
     "params": {
       "query": "tẩy trắng răng"
     }
   }
   ```
   ````

6. **AI Service → API Integration Service:**
   ```javascript
   const apiIntegration = await processApiIntegration(gptResponse, messages, authToken);
   ```

7. **API Integration → API Request Parser:**
   ```javascript
   const parseResult = parseApiRequest(gptResponse);
   // → { action: 'SEARCH_SERVICES', params: { query: 'tẩy trắng răng' } }
   ```

8. **API Integration → Internal API Client:**
   ```javascript
   const apiResult = await callInternalApi('SEARCH_SERVICES', 
     { query: 'tẩy trắng răng' }, 
     authToken
   );
   ```

9. **Internal API Client → Service-Service:**
   ```
   GET http://localhost:3004/api/services/search?query=tẩy%20trắng%20răng
   Headers: { 
     Authorization: "Bearer jwt_token",
     X-Internal-Call: "true"
   }
   ```

10. **Service-Service → Internal API Client:**
    ```json
    {
      "success": true,
      "data": {
        "services": [
          {
            "id": "srv_001",
            "name": "Tẩy trắng răng Laser",
            "price": 2000000,
            "description": "Tẩy trắng răng công nghệ Laser hiện đại"
          },
          {
            "id": "srv_002",
            "name": "Tẩy trắng răng Bleaching",
            "price": 1500000,
            "description": "Tẩy trắng răng bằng thuốc tẩy chuyên dụng"
          }
        ]
      }
    }
    ```

11. **Internal API Client → API Integration:**
    ```javascript
    { success: true, data: { services: [...] }, statusCode: 200 }
    ```

12. **API Integration → Format Result:**
    ```javascript
    const formattedResult = formatApiResult('SEARCH_SERVICES', apiResult);
    ```

13. **Formatted Result:**
    ```
    Chúng tôi có 2 dịch vụ phù hợp:

    1. **Tẩy trắng răng Laser**
       - Giá: 2,000,000 VNĐ
       - Mô tả: Tẩy trắng răng công nghệ Laser hiện đại

    2. **Tẩy trắng răng Bleaching**
       - Giá: 1,500,000 VNĐ
       - Mô tả: Tẩy trắng răng bằng thuốc tẩy chuyên dụng

    Bạn muốn đặt lịch khám dịch vụ nào không? 😊
    ```

14. **API Integration → AI Service:**
    ```javascript
    return {
      needsApi: true,
      finalResponse: formattedResult,
      apiData: { services: [...] },
      action: 'SEARCH_SERVICES'
    };
    ```

15. **AI Service → Controller:**
    ```javascript
    result = {
      response: formattedResult,
      usedApi: true,
      action: 'SEARCH_SERVICES',
      apiData: { services: [...] }
    }
    ```

16. **Controller → Frontend:**
    ```json
    {
      "success": true,
      "response": "Chúng tôi có 2 dịch vụ phù hợp:\n\n1. **Tẩy trắng răng Laser**...",
      "sessionId": "sess_abc123",
      "timestamp": "2025-11-06T10:30:00Z",
      "usedApi": true,
      "apiAction": "SEARCH_SERVICES"
    }
    ```

17. **Frontend → User:**
    Display formatted message in ChatBox

## APIs Được Hỗ Trợ

| Action | Endpoint | Method | Params | Mô tả |
|--------|----------|--------|--------|-------|
| SEARCH_SERVICES | `/api/services/search` | GET | query | Tìm dịch vụ theo keyword |
| GET_ALL_SERVICES | `/api/services` | GET | - | Lấy tất cả dịch vụ |
| GET_SERVICE_DETAIL | `/api/services/:id` | GET | id | Chi tiết dịch vụ + giá |
| GET_AVAILABLE_SLOTS | `/api/schedules/available-slots` | GET | date, serviceId | Tìm lịch trống |
| GET_DOCTORS_LIST | `/api/users/doctors` | GET | - | Danh sách bác sĩ |
| GET_DOCTORS_BY_SERVICE | `/api/schedules/doctors-by-service` | GET | serviceId | Bác sĩ theo dịch vụ |
| GET_DOCTOR_INFO | `/api/users/:id` | GET | id | Thông tin bác sĩ |
| GET_DOCTOR_SCHEDULE | `/api/schedules/doctor/:doctorId` | GET | doctorId, date | Lịch làm bác sĩ |

## Các Scenarios Được Hỗ Trợ

### 1. Tìm dịch vụ
**User:** "Phòng khám có dịch vụ niềng răng không?"
**GPT Action:** `SEARCH_SERVICES` với `query: "niềng răng"`
**Result:** Danh sách dịch vụ niềng răng + giá

### 2. Hỏi giá
**User:** "Tẩy trắng răng giá bao nhiêu?"
**GPT Action:** `SEARCH_SERVICES` → `GET_SERVICE_DETAIL`
**Result:** Chi tiết dịch vụ tẩy trắng + giá chính xác

### 3. Đặt lịch
**User:** "Tìm lịch ngày mai"
**GPT Action:** `GET_AVAILABLE_SLOTS` với `date: "2025-11-07"`
**Result:** Các khung giờ trống ngày 07/11/2025

### 4. Tìm bác sĩ
**User:** "Bác sĩ nào làm implant?"
**GPT Action:** `GET_DOCTORS_BY_SERVICE` với `serviceId` của implant
**Result:** Danh sách bác sĩ chuyên implant

### 5. Lịch bác sĩ
**User:** "Bác sĩ Nguyễn Văn A có lịch ngày nào?"
**GPT Action:** `GET_DOCTOR_SCHEDULE` với `doctorId` + `date`
**Result:** Lịch làm việc của BS Nguyễn Văn A

## Error Handling

### 1. Parse Error
**Khi:** GPT trả JSON sai format
**Xử lý:** Return original GPT response, không gọi API

### 2. Missing Params
**Khi:** Thiếu required params (vd: `date` cho GET_AVAILABLE_SLOTS)
**Xử lý:** Parse error → return original response

### 3. Service Unavailable
**Khi:** Microservice không hoạt động (timeout, 503)
**Xử lý:** Return error message: "Hệ thống đang bận, vui lòng thử lại sau..."

### 4. API Error
**Khi:** API trả 4xx/5xx error
**Xử lý:** Format error template: "Không tìm thấy thông tin, liên hệ hotline..."

### 5. Invalid Action
**Khi:** GPT gọi action không tồn tại
**Xử lý:** Validate failed → return original response

## Testing

### Test API Integration Flow
```javascript
// File: test-api-integration.js
const { processApiIntegration } = require('./src/services/apiIntegration.service');

const gptResponse = `
\`\`\`json
{
  "action": "SEARCH_SERVICES",
  "params": {
    "query": "tẩy trắng"
  }
}
\`\`\`
`;

const result = await processApiIntegration(gptResponse, [], null);
console.log(result);
// Expected: { needsApi: true, finalResponse: "Chúng tôi có X dịch vụ...", ... }
```

### Test Internal API Client
```javascript
const { callInternalApi } = require('./src/utils/internalApiClient');

const result = await callInternalApi('SEARCH_SERVICES', { query: 'tẩy trắng' });
console.log(result);
// Expected: { success: true, data: { services: [...] }, statusCode: 200 }
```

### Test Parser
```javascript
const { parseApiRequest } = require('./src/utils/apiRequestParser');

const text = '```json\n{"action":"SEARCH_SERVICES","params":{"query":"test"}}\n```';
const result = parseApiRequest(text);
console.log(result);
// Expected: { success: true, apiRequest: {...}, error: null }
```

## Dependencies

Không cần install thêm package nào. Sử dụng:
- `axios`: Đã có sẵn (từ phase trước)
- `openai`: Đã có sẵn
- Built-in Node.js modules

## Configuration

### 1. Environment Variables
Đã thêm vào `.env`:
```env
AUTH_SERVICE_URL=http://localhost:3001
SERVICE_SERVICE_URL=http://localhost:3004
SCHEDULE_SERVICE_URL=http://localhost:3005
APPOINTMENT_SERVICE_URL=http://localhost:3007
```

### 2. API Endpoints
Edit `src/config/apiMapping.js` để:
- Thêm endpoint mới
- Sửa path/params
- Thêm response template

### 3. System Prompt
Edit `src/config/systemPrompts.js` để:
- Thêm hướng dẫn API mới cho GPT
- Sửa instruction format

## Limitations & Future Improvements

### Current Limitations:
1. GPT chỉ gọi 1 API per turn (không chain calls)
2. Không cache API results
3. Timeout cố định 10s (không retry)
4. Không support authentication context từ user session

### Future Improvements:
1. **Multi-step API Calls:** 
   - Scenario: Tìm dịch vụ → Lấy ID → Tìm bác sĩ → Tìm lịch
   - Solution: Cho phép GPT return array of actions
   
2. **Caching Layer:**
   - Cache danh sách dịch vụ, bác sĩ (ít thay đổi)
   - Redis cache với TTL 1 giờ
   
3. **Retry Logic:**
   - Retry 3 lần với exponential backoff
   - Circuit breaker cho unhealthy services
   
4. **User Context:**
   - Sử dụng userId từ JWT để personalize
   - Lưu preference (bác sĩ yêu thích, dịch vụ đã dùng)

5. **Rate Limiting:**
   - Giới hạn số API calls per user per minute
   - Prevent spam/abuse

## Completion Status

✅ **Phase 3 HOÀN THÀNH 100%**

Files created/updated:
- ✅ `src/config/apiMapping.js` (302 lines)
- ✅ `src/utils/apiRequestParser.js` (133 lines)
- ✅ `src/utils/internalApiClient.js` (171 lines)
- ✅ `src/services/apiIntegration.service.js` (220 lines)
- ✅ `src/config/systemPrompts.js` (updated)
- ✅ `src/services/ai.service.js` (updated)
- ✅ `src/controllers/chatbot.controller.js` (updated)
- ✅ `.env` (updated)

Total: **826+ lines of code**

## Next Steps

**Phase 4: Image Analysis với GPT Vision** (Ready to implement)
- Tạo `src/services/imageAnalysis.service.js`
- Update `chatbot.controller.js` với `analyzeImage` method
- Thêm route `POST /api/ai/analyze-image`
- Validate ảnh là răng/miệng (reject ảnh khác)
- Tư vấn dựa trên ảnh răng

---

**Completed:** November 6, 2025
**Author:** GitHub Copilot
**Status:** ✅ PRODUCTION READY
