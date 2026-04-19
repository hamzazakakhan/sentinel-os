CREATE TYPE classification_level AS ENUM (
    'UNCLASSIFIED',
    'CONFIDENTIAL',
    'SECRET',
    'TOP_SECRET',
    'SCI'
);

CREATE TYPE domain_type AS ENUM (
    'LAND',
    'AIR',
    'SEA',
    'CYBER',
    'SPACE',
    'INTELLIGENCE',
    'OSINT'
);

CREATE TYPE threat_severity AS ENUM (
    'CRITICAL',
    'HIGH',
    'MEDIUM',
    'LOW',
    'INFORMATIONAL'
);

CREATE TYPE alert_status AS ENUM (
    'NEW',
    'ACKNOWLEDGED',
    'INVESTIGATING',
    'ESCALATED',
    'RESOLVED',
    'FALSE_POSITIVE',
    'CLOSED'
);

CREATE TYPE sensor_type AS ENUM (
    'CCTV',
    'DRONE',
    'RADAR',
    'IOT',
    'ACOUSTIC',
    'SEISMIC',
    'RF',
    'LIDAR',
    'THERMAL',
    'SATELLITE'
);

CREATE TYPE sensor_status AS ENUM (
    'ONLINE',
    'OFFLINE',
    'DEGRADED',
    'MAINTENANCE',
    'DECOMMISSIONED'
);

CREATE TYPE mission_status AS ENUM (
    'PLANNED',
    'BRIEFED',
    'ACTIVE',
    'PAUSED',
    'COMPLETED',
    'ABORTED',
    'ARCHIVED'
);

CREATE TYPE task_status AS ENUM (
    'PENDING',
    'ASSIGNED',
    'IN_PROGRESS',
    'AWAITING_APPROVAL',
    'COMPLETED',
    'FAILED',
    'CANCELLED'
);

CREATE TYPE task_priority AS ENUM (
    'FLASH',
    'IMMEDIATE',
    'PRIORITY',
    'ROUTINE',
    'DEFERRED'
);

CREATE TYPE response_action_type AS ENUM (
    'BLOCK_IP',
    'ISOLATE_HOST',
    'QUARANTINE_FILE',
    'DISABLE_ACCOUNT',
    'ALERT_OPERATOR',
    'DISPATCH_UNIT',
    'LOCK_PERIMETER',
    'ACTIVATE_COUNTERMEASURE',
    'ESCALATE',
    'LOG_ONLY',
    'CUSTOM'
);

CREATE TYPE approval_status AS ENUM (
    'PENDING',
    'APPROVED',
    'REJECTED',
    'EXPIRED',
    'AUTO_APPROVED'
);

CREATE TYPE user_role AS ENUM (
    'SYSTEM_ADMIN',
    'SECURITY_ADMIN',
    'ANALYST',
    'OPERATOR',
    'COMMANDER',
    'INTELLIGENCE_OFFICER',
    'CYBER_OPERATOR',
    'OSINT_ANALYST',
    'AUDITOR',
    'VIEWER',
    'API_SERVICE'
);

CREATE TYPE model_status AS ENUM (
    'TRAINING',
    'VALIDATING',
    'ACTIVE',
    'DEGRADED',
    'RETIRED',
    'ROLLED_BACK'
);

CREATE TYPE source_reliability AS ENUM (
    'A_RELIABLE',
    'B_USUALLY_RELIABLE',
    'C_FAIRLY_RELIABLE',
    'D_NOT_USUALLY_RELIABLE',
    'E_UNRELIABLE',
    'F_CANNOT_BE_JUDGED'
);

CREATE TYPE information_credibility AS ENUM (
    '1_CONFIRMED',
    '2_PROBABLY_TRUE',
    '3_POSSIBLY_TRUE',
    '4_DOUBTFULLY_TRUE',
    '5_IMPROBABLE',
    '6_CANNOT_BE_JUDGED'
);
