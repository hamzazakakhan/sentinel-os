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
      id
      approvalStatus
      executedAt
    }
  }
`;

export const REJECT_EXECUTION = gql`
  mutation RejectExecution($executionId: ID!, $notes: String) {
    rejectExecution(executionId: $executionId, notes: $notes) {
      id
      approvalStatus
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
