import { gql } from '@apollo/client';

export const ACKNOWLEDGE_ALERT = gql`
  mutation AcknowledgeAlert($id: ID!) {
    acknowledgeAlert(id: $id) {
      id
      status
      updatedAt
    }
  }
`;

export const UPDATE_ALERT_STATUS = gql`
  mutation UpdateAlertStatus($id: ID!, $status: AlertStatus!) {
    updateAlertStatus(id: $id, status: $status) {
      id
      status
      updatedAt
    }
  }
`;

export const APPROVE_EXECUTION = gql`
  mutation ApproveExecution($executionId: ID!, $notes: String) {
    approveExecution(executionId: $executionId, notes: $notes) {
      success
      message
      id
    }
  }
`;

export const REJECT_EXECUTION = gql`
  mutation RejectExecution($executionId: ID!, $notes: String) {
    rejectExecution(executionId: $executionId, notes: $notes) {
      success
      message
      id
    }
  }
`;

export const TOGGLE_RESPONSE_RULE = gql`
  mutation ToggleResponseRule($id: ID!, $isActive: Boolean!) {
    toggleResponseRule(id: $id, isActive: $isActive) {
      id
      isActive
    }
  }
`;

export const CREATE_SIMULATION = gql`
  mutation CreateSimulation($input: SimulationInput!) {
    createSimulation(input: $input) {
      id
      name
      scenarioType
      status
    }
  }
`;

export const START_SIMULATION = gql`
  mutation StartSimulation($id: ID!) {
    startSimulation(id: $id) {
      id
      status
      totalEvents
    }
  }
`;

export const CREATE_ALERT = gql`
  mutation CreateAlert($title: String!, $severity: String!, $domain: String!, $description: String, $sourceType: String, $confidence: Float, $tags: [String!]) {
    createAlert(title: $title, severity: $severity, domain: $domain, description: $description, sourceType: $sourceType, confidence: $confidence, tags: $tags) {
      success
      message
      id
    }
  }
`;

export const CREATE_SENSOR = gql`
  mutation CreateSensor($name: String!, $sensorType: String!, $domain: String!, $status: String, $latitude: Float, $longitude: Float) {
    createSensor(name: $name, sensorType: $sensorType, domain: $domain, status: $status, latitude: $latitude, longitude: $longitude) {
      success
      message
      id
    }
  }
`;

export const CREATE_CYBER_EVENT = gql`
  mutation CreateCyberEvent($eventType: String!, $severity: String!, $sourceIp: String, $destinationIp: String, $sourcePort: Int, $destinationPort: Int, $protocol: String, $signatureName: String) {
    createCyberEvent(eventType: $eventType, severity: $severity, sourceIp: $sourceIp, destinationIp: $destinationIp, sourcePort: $sourcePort, destinationPort: $destinationPort, protocol: $protocol, signatureName: $signatureName) {
      success
      message
      id
    }
  }
`;

export const CREATE_THREAT_INDICATOR = gql`
  mutation CreateThreatIndicator($indicatorType: String!, $value: String!, $severity: String!, $threatType: String, $sourceFeed: String, $confidence: Float, $tags: [String!]) {
    createThreatIndicator(indicatorType: $indicatorType, value: $value, severity: $severity, threatType: $threatType, sourceFeed: $sourceFeed, confidence: $confidence, tags: $tags) {
      success
      message
      id
    }
  }
`;

export const CREATE_OSINT_ITEM = gql`
  mutation CreateOsintItem($sourceType: String!, $sourceName: String, $content: String, $threatScore: Float) {
    createOsintItem(sourceType: $sourceType, sourceName: $sourceName, content: $content, threatScore: $threatScore) {
      success
      message
      id
    }
  }
`;

export const INGEST_AI_INTELLIGENCE = gql`
  mutation IngestAiIntelligence($rawText: String!, $source: String, $latitude: Float, $longitude: Float) {
    ingestAiIntelligence(rawText: $rawText, source: $source, latitude: $latitude, longitude: $longitude) {
      success
      message
      id
    }
  }
`;
