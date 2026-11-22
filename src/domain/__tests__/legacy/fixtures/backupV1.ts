// FROZEN: a real format 1 export of release 1.0.1. Do not edit.
export const BACKUP_V1_TEXT = `{
  "format": "achievement-tracker-backup",
  "formatVersion": 1,
  "exportedAt": "2026-02-10T08:15:00.000Z",
  "activities": [
    { "id": "a1", "name": "Running km", "createdAt": "2026-01-05T07:00:00.000Z", "createdSeq": 1 },
    { "id": "a2", "name": "Pages read", "createdAt": "2026-01-06T07:00:00.000Z", "createdSeq": 2 }
  ],
  "dailyValues": [
    { "activityId": "a1", "date": "2026-02-09", "value": "12.500" },
    { "activityId": "a1", "date": "2026-02-10", "value": "0.000" },
    { "activityId": "a2", "date": "2026-02-09", "value": "30.000" }
  ],
  "goalVersions": [
    { "activityId": "a1", "goalType": "weekly", "startPeriod": "2026-W07", "kind": "set", "value": "50.000" },
    { "activityId": "a1", "goalType": "monthly", "startPeriod": "2026-02", "kind": "removal" }
  ]
}
`
