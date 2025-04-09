# API Test Framework Architecture

```mermaid
%%{init: {
  'theme': 'dark',
  'themeVariables': {
    'primaryTextColor': '#fff',
    'primaryColor': '#fff',
    'secondaryColor': 'transparent',
    'tertiaryColor': 'transparent',
    'noteTextColor': '#fff',
    'noteBkgColor': 'rgba(255, 255, 255, 0.1)',
    'activationBorderColor': '#fff',
    'activationBkgColor': 'rgba(255, 255, 255, 0.1)',
    'sequenceNumberColor': '#fff',
    'actorBorder': '#fff',
    'actorBkg': 'transparent',
    'actorTextColor': '#fff',
    'actorLineColor': '#fff',
    'signalColor': '#fff',
    'signalTextColor': '#fff',
    'labelBoxBkgColor': 'transparent',
    'labelBoxBorderColor': '#fff',
    'labelTextColor': '#fff'
  }
}}%%
sequenceDiagram
    autonumber

    actor User
    participant UI as "Web/CLI Interface"
    participant QAi as "QAi Framework"
    participant Bedrock as "AWS Bedrock"
    participant Mock as "Mock Server"
    participant Tests as "CodeceptJS Runner"

    rect rgba(255, 255, 255, 0.05)
        Note over User,Tests: Phase 1: Swagger Processing & Endpoint Selection
        User->>+UI: Upload Swagger file
        UI->>+QAi: Process Swagger
        QAi->>QAi: Extract all endpoints
        QAi-->>-UI: Return available endpoints
        UI-->>-User: Display endpoints list with details

        User->>+UI: Select endpoints for testing
        UI->>+QAi: Send selected endpoints
        QAi-->>-UI: Confirm selection
        UI-->>-User: Show selected endpoints
    end

    rect rgba(255, 255, 255, 0.05)
        Note over User,Tests: Phase 2: Test Data Generation
        QAi->>+Bedrock: Generate test data
        Bedrock-->>-QAi: Return test data
        QAi-->>UI: Test data generated
        UI-->>User: Display test data

        opt Review and Approve Test Data
            User->>+UI: Validate/modify test data
            UI->>+QAi: Update test data
            QAi-->>-UI: Test data updated
            UI-->>-User: Display updated test data
        end

        opt User Chooses to Add Validations
            Note over QAi,Bedrock: Auto-generate Validations
            QAi->>+Bedrock: Generate validation rules based on:<br/>1. Schema constraints<br/>2. Test data patterns<br/>3. Common API validations
            Bedrock-->>-QAi: Return suggested validations
            QAi-->>UI: Display validation suggestions
            UI-->>User: Review validation rules

            opt Review and Modify Validations
                User->>+UI: Modify validation rules
                Note right of UI: Add/Remove/Modify:<br/>- Schema validations<br/>- Business rules<br/>- Custom assertions
                UI->>+QAi: Update validation rules
                QAi-->>-UI: Validations updated
                UI-->>-User: Display updated validations
            end
        end
    end

    rect rgba(255, 255, 255, 0.05)
        Note over User,Tests: Phase 3: Test Script Generation
        QAi->>+Bedrock: Generate test scripts based on:<br/>1. Approved test data<br/>2. Validations (if added)
        Bedrock-->>-QAi: Return test scripts
        QAi-->>UI: Display generated test scripts
        UI-->>User: View test scripts

        opt Review and Update Scripts
            User->>+UI: Modify test scripts
            UI->>+QAi: Update test scripts
            QAi-->>-UI: Scripts updated
            UI-->>-User: Display updated scripts
        end
    end

    rect rgba(255, 255, 255, 0.05)
        Note over User,Tests: Phase 4: Test Execution
        alt Mock Server Testing
            User->>+UI: Execute: run test mock
            UI->>+QAi: Request mock testing
            QAi->>+Mock: Start mock server
            Mock-->>-QAi: Server ready
            QAi->>+Tests: Execute tests
            Tests-->>-QAi: Return test results
            QAi-->>-UI: Results processed
            UI-->>-User: Display test results
        else Development Testing
            User->>+UI: Execute: run test dev
            UI->>+QAi: Request dev testing
            QAi->>+Tests: Execute tests against dev URL
            Tests-->>-QAi: Return test results
            QAi-->>-UI: Results processed
            UI-->>-User: Display test results
        end
    end
```
