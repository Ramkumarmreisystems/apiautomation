# API Contracts for Test Framework Microservices

## 1. API Gateway Contracts

### Authentication Endpoints
```
POST /api/auth/login
Request:
{
  "username": string,
  "password": string
}
Response:
{
  "token": string,
  "refreshToken": string,
  "expiresIn": number
}

POST /api/auth/refresh
Request:
{
  "refreshToken": string
}
Response:
{
  "token": string,
  "refreshToken": string,
  "expiresIn": number
}
```

## 2. Swagger Processing Service

### Process Swagger Document
```
POST /api/swagger/process
Request:
{
  "swaggerDoc": object,
  "projectId": string
}
Response:
{
  "processId": string,
  "endpoints": [
    {
      "path": string,
      "method": string,
      "operationId": string,
      "parameters": array,
      "requestBody": object,
      "responses": object
    }
  ]
}

Events Emitted:
- swagger.processed
  {
    "processId": string,
    "projectId": string,
    "endpoints": array
  }
```

## 3. Test Generation Service

### Generate Test Cases
```
POST /api/tests/generate
Request:
{
  "processId": string,
  "endpoints": array,
  "testingLevel": "smoke" | "regression" | "full"
}
Response:
{
  "generationId": string,
  "status": "processing" | "completed" | "failed"
}

GET /api/tests/generate/{generationId}
Response:
{
  "generationId": string,
  "status": string,
  "testCases": [
    {
      "id": string,
      "endpoint": string,
      "method": string,
      "testData": array,
      "expectedResults": array
    }
  ]
}

Events Emitted:
- tests.generated
  {
    "generationId": string,
    "testCases": array
  }
```

## 4. Validation Service

### Create Validation Rules
```
POST /api/validations/create
Request:
{
  "testCases": array,
  "rules": [
    {
      "type": "schema" | "business" | "performance",
      "condition": string,
      "expectedResult": any
    }
  ]
}
Response:
{
  "validationId": string,
  "status": "created"
}

Events Emitted:
- validations.created
  {
    "validationId": string,
    "testCases": array,
    "rules": array
  }
```

## 5. Test Execution Service

### Execute Tests
```
POST /api/execution/run
Request:
{
  "testCases": array,
  "environment": "mock" | "dev" | "qa",
  "configuration": {
    "parallel": boolean,
    "retries": number,
    "timeout": number
  }
}
Response:
{
  "executionId": string,
  "status": "running"
}

GET /api/execution/{executionId}/status
Response:
{
  "executionId": string,
  "status": "running" | "completed" | "failed",
  "progress": number,
  "results": array
}

Events Emitted:
- execution.started
  {
    "executionId": string,
    "timestamp": string
  }
- execution.completed
  {
    "executionId": string,
    "results": array
  }
```

## 6. Mock Service

### Mock API Configuration
```
POST /api/mock/configure
Request:
{
  "endpoints": [
    {
      "path": string,
      "method": string,
      "response": {
        "status": number,
        "headers": object,
        "body": any
      }
    }
  ]
}
Response:
{
  "mockId": string,
  "status": "configured",
  "baseUrl": string
}

Events Emitted:
- mock.configured
  {
    "mockId": string,
    "endpoints": array
  }
```

## 7. Reporting Service

### Generate Reports
```
POST /api/reports/generate
Request:
{
  "executionId": string,
  "type": "allure" | "custom",
  "options": {
    "includeLogs": boolean,
    "includeScreenshots": boolean
  }
}
Response:
{
  "reportId": string,
  "status": "generating"
}

GET /api/reports/{reportId}
Response:
{
  "reportId": string,
  "status": "completed",
  "url": string,
  "summary": {
    "total": number,
    "passed": number,
    "failed": number,
    "duration": number
  }
}

Events Emitted:
- report.generated
  {
    "reportId": string,
    "executionId": string,
    "url": string
  }
```

## Event Bus Topics

### Kafka Topics Structure
```
test-framework.swagger.processed
test-framework.tests.generated
test-framework.validations.created
test-framework.execution.started
test-framework.execution.completed
test-framework.mock.configured
test-framework.report.generated
```

## Common Response Formats

### Error Response
```
{
  "error": {
    "code": string,
    "message": string,
    "details": object
  },
  "requestId": string,
  "timestamp": string
}
```

### Pagination Response
```
{
  "data": array,
  "pagination": {
    "page": number,
    "pageSize": number,
    "totalItems": number,
    "totalPages": number
  }
}
```
