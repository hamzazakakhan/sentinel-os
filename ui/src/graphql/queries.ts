import { gql } from '@apollo/client';

// ── Alerts ──────────────────────────────────────────────────────────────────

export const GET_ALERTS = gql`
  query GetAlerts($filter: AlertFilterInput, $pagination: PaginationInput) {
    alerts(filter: $filter, pagination: $pagination) {
      edges {
        node {
          id
          title
          description
          severity
          status
          domain
          sourceType
          sourceId
          confidence
          tags
          classification
          createdAt
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
  query GetAlert($id: UUID!) {
    alert(id: $id) {
      id
      title
      description
      severity
      domain
      status
      sourceType
      sourceId
      confidence
      tags
      classification
      createdAt
    }
  }
`;

export const GET_ALERT_STATS = gql`
  query GetAlertStats {
    alertStats {
      total
      critical
      high
      medium
      low
      open
      investigating
      resolved
      byDomain {
        domain
        count
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
  query GetSensors($types: [SensorType!], $statuses: [SensorStatus!], $domain: DomainType, $pagination: PaginationInput) {
    sensors(types: $types, statuses: $statuses, domain: $domain, pagination: $pagination) {
      edges {
        node {
          id
          name
          sensorType
          domain
          status
          classification
          lastHeartbeatAt
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
    sensorStats {
      total
      online
      degraded
      offline
    }
  }
`;

// ── Cyber ───────────────────────────────────────────────────────────────────

export const GET_CYBER_EVENTS = gql`
  query GetCyberEvents($filter: CyberEventFilterInput, $pagination: PaginationInput) {
    cyberEvents(filter: $filter, pagination: $pagination) {
      edges {
        node {
          id
          eventType
          severity
          sourceIp
          destinationIp
          destinationPort
          protocol
          signatureId
          signatureName
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

export const GET_THREAT_INDICATORS = gql`
  query GetThreatIndicators($indicatorType: String, $isActive: Boolean, $pagination: PaginationInput) {
    threatIndicators(indicatorType: $indicatorType, isActive: $isActive, pagination: $pagination) {
      id
      indicatorType
      value
      severity
      sourceFeed
      confidence
      tags
      firstSeenAt
    }
  }
`;

export const GET_CYBER_STATS = gql`
  query GetCyberStats {
    cyberStats {
      totalEvents24h
      idsAlerts
      iocMatches
      blocked
    }
  }
`;

// ── OSINT ───────────────────────────────────────────────────────────────────

export const GET_OSINT_FEEDS = gql`
  query GetOsintFeeds {
    osintFeeds {
      id
      name
      feedType
      type
      status
      url
      lastFetch
      itemsFetched
      itemCount
      errorCount
    }
  }
`;

export const GET_OSINT_ITEMS = gql`
  query GetOsintItems($filter: OsintFilterInput, $pagination: PaginationInput) {
    osintItems(filter: $filter, pagination: $pagination) {
      edges {
        node {
          id
          sourceType
          sourceUrl
          sourceName
          content {
            text
            title
          }
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
      correlations24h
      topEntityTypes {
        type
        count
      }
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
      actionType
      severityThreshold
      requiresApproval
      isActive
      cooldownMinutes
      maxExecutionsPerHour
      priority
      classification
    }
  }
`;

export const GET_PENDING_APPROVALS = gql`
  query GetPendingApprovals {
    pendingApprovals {
      id
      status
      justification
      expiresAt
      createdAt
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
    alertStats {
      total
      critical
      high
      medium
      low
      open
      investigating
      resolved
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
      totalEvents24h
      idsAlerts
      iocMatches
      blocked
    }
    responseStats {
      activeRules
      pendingApprovals
      executed24h
      rejected24h
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
