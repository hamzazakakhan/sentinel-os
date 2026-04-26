import { gql } from '@apollo/client';

// ── Alerts ──────────────────────────────────────────────────────────────────

export const GET_ALERTS = gql`
  query GetAlerts($filter: AlertFilterInput, $pagination: PaginationInput) {
    alerts(filter: $filter, pagination: $pagination) {
      edges {
        cursor
        node {
          id
          title
          description
          severity
          status
          domain
          sourceType
          confidence
          tags
          createdAt
          updatedAt
        }
      }
      pageInfo {
        hasNextPage
        endCursor
        totalCount
      }
    }
  }
`;

export const GET_ALERT_BY_ID = gql`
  query GetAlert($filter: AlertFilterInput, $pagination: PaginationInput) {
    alerts(filter: $filter, pagination: $pagination) {
      edges {
        node {
          id
          title
          description
          severity
          domain
          status
          sourceType
          confidence
          tags
          createdAt
          updatedAt
        }
      }
    }
  }
`;

export const GET_ALERT_STATS = gql`
  query GetAlertStats {
    dashboardData {
      alertStats {
        total
        critical
        high
        medium
        low
        unacknowledged
        byDomain {
          domain
          count
        }
      }
    }
  }
`;

// ── Detections ──────────────────────────────────────────────────────────────

export const GET_DETECTIONS = gql`
  query GetDetections($filter: DetectionFilterInput, $pagination: PaginationInput) {
    detections(filter: $filter, pagination: $pagination) {
      edges {
        node {
          id
          detectionType
          domain
          confidence
          location {
            latitude
            longitude
          }
          classification
          detectedAt
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// ── Sensors ─────────────────────────────────────────────────────────────────

export const GET_SENSORS = gql`
  query GetSensors($filter: SensorFilterInput, $pagination: PaginationInput) {
    sensors(filter: $filter, pagination: $pagination) {
      edges {
        cursor
        node {
          id
          name
          sensorType
          domain
          status
          lastHeartbeatAt
          createdAt
        }
      }
      pageInfo {
        hasNextPage
        totalCount
      }
    }
  }
`;

export const GET_SENSOR_STATS = gql`
  query GetSensorStats {
    dashboardData {
      sensorStats {
        total
        online
        degraded
        offline
      }
    }
  }
`;

// ── Cyber ───────────────────────────────────────────────────────────────────

export const GET_CYBER_EVENTS = gql`
  query GetCyberEvents($filter: CyberEventFilterInput, $pagination: PaginationInput) {
    cyberEvents(filter: $filter, pagination: $pagination) {
      edges {
        cursor
        node {
          id
          eventType
          severity
          sourceIp
          destinationIp
          sourcePort
          destinationPort
          protocol
          signatureName
          detectedAt
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const GET_THREAT_INDICATORS = gql`
  query GetThreatIndicators($pagination: PaginationInput) {
    threatIndicators(pagination: $pagination) {
      edges {
        cursor
        node {
          id
          indicatorType
          value
          severity
          sourceFeed
          confidence
          firstSeenAt
          lastSeenAt
          isActive
        }
      }
      pageInfo {
        hasNextPage
        totalCount
      }
    }
  }
`;

export const GET_CYBER_STATS = gql`
  query GetCyberStats {
    dashboardData {
      cyberStats {
        totalEvents
        blocked
        criticalEvents
      }
    }
  }
`;

// ── OSINT ───────────────────────────────────────────────────────────────────

export const GET_OSINT_FEEDS = gql`
  query GetOsintFeeds {
    osintFeeds {
      id
      name
      sourceType
      isActive
      pollIntervalSec
      itemsCollected
      lastPoll
    }
  }
`;

export const GET_OSINT_ITEMS = gql`
  query GetOsintItems($pagination: PaginationInput) {
    osintItems(pagination: $pagination) {
      edges {
        cursor
        node {
          id
          sourceType
          sourceName
          content
          sentimentScore
          threatScore
          collectedAt
          publishedAt
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// ── Fusion / Graph ──────────────────────────────────────────────────────────

export const GET_ENTITY_GRAPH = gql`
  query GetGraphQuery($input: GraphQueryInput!) {
    graphQuery(input: $input) {
      id
      entityType
      name
      domain
      description
      attributes
      confidence
      relationships {
        id
        relationshipType
        confidence
      }
    }
  }
`;

export const GET_CORRELATIONS = gql`
  query GetCorrelations($limit: Int) {
    correlations(limit: $limit) {
      id
      sourceAlertId
      targetAlertId
      correlationType
      confidence
      hypothesis
      createdAt
    }
  }
`;

export const GET_FUSION_STATS = gql`
  query GetFusionStats {
    fusionStats {
      totalEntities
      totalRelationships
      threatActors
      correlations24h
    }
  }
`;

// ── Response ────────────────────────────────────────────────────────────────

export const GET_RESPONSE_RULES = gql`
  query GetResponseRules($isActive: Boolean) {
    responseRules(isActive: $isActive) {
      id
      name
      description
      severityThreshold
      requiresApproval
      isActive
      cooldownMinutes
    }
  }
`;

export const GET_PENDING_APPROVALS = gql`
  query GetPendingApprovals {
    pendingApprovals {
      id
      ruleName
      justification
      trigger
      expiresAt
      expiresIn
    }
  }
`;

export const GET_RESPONSE_STATS = gql`
  query GetResponseStats {
    responseStats {
      activeRules
      pendingApprovals
      executed24h
      rejected24h
    }
  }
`;

// ── Dashboard ───────────────────────────────────────────────────────────────

export const GET_DASHBOARD_DATA = gql`
  query GetDashboardData {
    dashboardData {
      alertStats {
        total
        critical
        high
        medium
        low
        unacknowledged
        byDomain {
          domain
          count
        }
      }
      sensorStats {
        total
        online
        degraded
        offline
      }
      cyberStats {
        totalEvents
        blocked
        criticalEvents
      }
    }
  }
`;

// ── Tracks ──────────────────────────────────────────────────────────────────

export const GET_TRACKS = gql`
  query GetTracks($filter: TrackFilterInput, $pagination: PaginationInput) {
    tracks(filter: $filter, pagination: $pagination) {
      edges {
        node {
          id
          trackNumber
          entityType
          domain
          currentLocation {
            latitude
            longitude
          }
          speed
          heading
          confidence
          threatAssessment
          classification
          isActive
          lastUpdatedAt
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// ── Missions / Tasks ────────────────────────────────────────────────────────

export const GET_MISSIONS = gql`
  query GetMissions($status: MissionStatus) {
    missions(status: $status) {
      id
      name
      description
      status
      classification
      startTime
      endTime
    }
  }
`;
