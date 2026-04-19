import { gql } from '@apollo/client';

export const ALERT_CREATED = gql`
  subscription OnAlertCreated {
    alertCreated {
      id
      title
      description
      severity
      domain
      status
      latitude
      longitude
      classification
      createdAt
    }
  }
`;

export const ALERT_UPDATED = gql`
  subscription OnAlertUpdated {
    alertUpdated {
      id
      title
      severity
      domain
      status
      updatedAt
    }
  }
`;

export const DETECTION_CREATED = gql`
  subscription OnDetectionCreated {
    detectionCreated {
      id
      sensorId
      detectionType
      domain
      confidence
      latitude
      longitude
      metadata
      createdAt
    }
  }
`;

export const SENSOR_STATUS_CHANGED = gql`
  subscription OnSensorStatusChanged {
    sensorStatusChanged {
      id
      name
      status
      lastHeartbeat
    }
  }
`;

export const CYBER_EVENT_CREATED = gql`
  subscription OnCyberEventCreated {
    cyberEventCreated {
      id
      eventType
      severity
      sourceIp
      destinationIp
      destinationPort
      signature
      createdAt
    }
  }
`;

export const TRACK_UPDATED = gql`
  subscription OnTrackUpdated {
    trackUpdated {
      id
      trackType
      domain
      status
      latitude
      longitude
      metadata
      updatedAt
    }
  }
`;
