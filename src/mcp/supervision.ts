// Internal parent/child protocol, independent of persistent job heartbeats.
export const supervisorHeartbeatType = "skilled.supervisor-heartbeat";
export const supervisorHeartbeatMs = 1_000;
export const supervisorLeaseMs = 10_000;
