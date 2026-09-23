# Administration API Specification (Nframa Admin System)

> **Version:** 1.0.0  
> **Base Path:** `/api/v1/admin`  
> **Headers:** `Content-Type: application/json`  
> **Auth Header:** `Authorization: Bearer <access_token>` (Required for all endpoints)

---

## Overview

This specification details all backend REST API endpoints, request payloads, query parameters, response structures, and domain constraints for the **Administration** module of the Nframa Mobility Admin System.

It covers three core domains:
1. **Admin Users Management** (`/api/v1/admin/users`) — Accounts, invitations, credential provisioning, profile updates, account suspensions, and deletions.
2. **Roles & Permissions (RBAC)** (`/api/v1/admin/roles`) — Dynamic role creation, granular module-level CRUD permissions, role assignment, and foreign-key deletion guards.
3. **Activity & Audit Logs** (`/api/v1/admin/activity-logs`) — Immutable audit trail of administrative actions, actor tracking, IP addresses, targets, and execution results.

---

## 1. System Modules & Permission Model

All role permissions are mapped against the platform's core system modules:

| Module Identifier (`moduleId`) | Module Display Name | Description |
| :--- | :--- | :--- |
| `overview` | Operational Overview | Top-level KPI metrics, live fleet stats, corridor health. |
| `users` | User Management | Rider and Car Owner profiles, tiers, compliance status. |
| `trip-operations` | Trip Operations | Live tracking, scheduled trips, disputes, misconduct. |
| `verification` | Driver Verification | Ghana Card (NIA), DVLA license, insurance review. |
| `route-management` | Route Management | Intercity corridors, waypoints, geofences, base fares. |
| `finance` | Finance & Wallets | Rider/Owner wallets, payout queues, refunds, audit. |
| `safety` | Safety (SOS) | Emergency panic triggers, incident dispatch, alerts. |
| `support` | Support & Tickets | Help tickets, user chat threads, broadcast studio. |
| `administration` | Administration | Administrator accounts, custom roles, activity logs. |
| `settings` | Settings | Platform controls, fare algorithms, notification configs. |

Each module supports four granular boolean operations:
```json
{
  "create": boolean,
  "read": boolean,
  "update": boolean,
  "delete": boolean
}
```

---

## 2. Admin Users Management

### 2.1 List Admin Users
Retrieves a paginated list of administrator accounts with optional search and filtering.

* **Endpoint:** `GET /api/v1/admin/users`
* **Auth Required:** Yes (`Bearer <token>`)

#### Query Parameters
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `search` | `string` | No | Search query matching admin `name` or `email`. |
| `role` | `string` | No | Filter by assigned role (e.g., `Super Admin`, `Finance Admin`). |
| `status` | `string` | No | Filter by status: `Active`, `Invited`, or `Suspended`. |
| `page` | `integer`| No | Current page number (Default: `1`). |
| `limit` | `integer`| No | Items per page (Default: `10`). |

#### Response (200 OK)
```json
{
  "success": true,
  "data": {
    "stats": {
      "total": 10,
      "active": 7,
      "invited": 2,
      "suspended": 1
    },
    "pagination": {
      "page": 1,
      "limit": 10,
      "totalPages": 1,
      "totalItems": 10
    },
    "items": [
      {
        "id": "ADM-1001",
        "name": "Akosua Buabeng",
        "email": "a.buabeng@nframa.com",
        "role": "Super Admin",
        "status": "Active",
        "lastLogin": "Just now",
        "createdOn": "Jan 1, 2025"
      },
      {
        "id": "ADM-1002",
        "name": "Kwame Appiah",
        "email": "kwame.appiah@nframa.com",
        "role": "Finance Admin",
        "status": "Active",
        "lastLogin": "4h ago",
        "createdOn": "Feb 5, 2025"
      },
      {
        "id": "ADM-1004",
        "name": "Ama Mensah",
        "email": "ama.mensah@nframa.com",
        "role": "Safety Admin",
        "status": "Invited",
        "lastLogin": "Never",
        "createdOn": "Apr 12, 2025"
      }
    ]
  }
}
```

---

### 2.2 Create / Invite Admin User
Provisions a new administrator account and sends an invitation / initial setup email.

* **Endpoint:** `POST /api/v1/admin/users`
* **Auth Required:** Yes (`Bearer <token>`)

#### Request Body
```json
{
  "name": "Kojo Darko",
  "email": "kojo.darko@nframa.com",
  "role": "Support Admin",
  "password": "TemporaryPassword2026!",
  "confirmPassword": "TemporaryPassword2026!"
}
```

#### Validation Rules
* `name`: Required, non-empty string.
* `email`: Required, valid email format, must be unique across the platform.
* `role`: Required, must match an existing role name in the system.
* `password`: Minimum 8 characters. Must match `confirmPassword`.

#### Response (201 Created)
```json
{
  "success": true,
  "message": "Admin user invited successfully.",
  "data": {
    "id": "ADM-1011",
    "name": "Kojo Darko",
    "email": "kojo.darko@nframa.com",
    "role": "Support Admin",
    "status": "Invited",
    "lastLogin": "Never",
    "createdOn": "Mar 23, 2026"
  }
}
```

#### Errors
* **400 Bad Request:** Validation failed (e.g. passwords do not match or email is malformed).
* **409 Conflict:** An administrator with this email address already exists.

---

### 2.3 Get Single Admin User
Retrieves full details for a specific administrator account.

* **Endpoint:** `GET /api/v1/admin/users/{id}`
* **Auth Required:** Yes (`Bearer <token>`)

#### Path Parameters
* `id` (`string`): The unique admin ID (e.g., `ADM-1002`).

#### Response (200 OK)
```json
{
  "success": true,
  "data": {
    "id": "ADM-1002",
    "name": "Kwame Appiah",
    "email": "kwame.appiah@nframa.com",
    "role": "Finance Admin",
    "status": "Active",
    "lastLogin": "4h ago",
    "createdOn": "Feb 5, 2025"
  }
}
```

---

### 2.4 Update Admin User
Updates mutable profile fields for an administrator. Password is optional; if omitted or blank, the current password remains unchanged.

* **Endpoint:** `PUT /api/v1/admin/users/{id}`
* **Auth Required:** Yes (`Bearer <token>`)

#### Request Body
```json
{
  "name": "Kwame K. Appiah",
  "email": "kwame.appiah@nframa.com",
  "role": "Finance Admin",
  "password": "NewSecurePassword2026!",
  "confirmPassword": "NewSecurePassword2026!"
}
```
*(Omit `password` and `confirmPassword` if not updating password).*

#### Response (200 OK)
```json
{
  "success": true,
  "message": "Admin user updated successfully.",
  "data": {
    "id": "ADM-1002",
    "name": "Kwame K. Appiah",
    "email": "kwame.appiah@nframa.com",
    "role": "Finance Admin",
    "status": "Active",
    "lastLogin": "4h ago",
    "createdOn": "Feb 5, 2025"
  }
}
```

---

### 2.5 Change Admin User Status (Suspend / Reinstate)
Toggles the administrative access status of an account. Suspended accounts are immediately invalidated and cannot authenticate.

* **Endpoint:** `PATCH /api/v1/admin/users/{id}/status`
* **Auth Required:** Yes (`Bearer <token>`)

#### Request Body
```json
{
  "status": "Suspended"
}
```
*(Valid values: `"Active"` or `"Suspended"`).*

#### Response (200 OK)
```json
{
  "success": true,
  "message": "Admin user account suspended successfully.",
  "data": {
    "id": "ADM-1002",
    "status": "Suspended"
  }
}
```

#### Errors
* **400 Bad Request:** Invalid status value provided.
* **403 Forbidden:** Cannot suspend your own account or the primary Super Admin.

---

### 2.6 Delete Admin User
Permanently deletes an administrator account.

* **Endpoint:** `DELETE /api/v1/admin/users/{id}`
* **Auth Required:** Yes (`Bearer <token>`)

#### Response (200 OK)
```json
{
  "success": true,
  "message": "Admin user deleted successfully."
}
```

#### Errors
* **403 Forbidden:** Primary Super Admin accounts cannot be deleted.

---

## 3. Roles & Permissions (RBAC)

### 3.1 List All Roles
Retrieves all defined roles, their module access lists, granular CRUD permissions, and the count of administrators currently assigned to each.

* **Endpoint:** `GET /api/v1/admin/roles`
* **Auth Required:** Yes (`Bearer <token>`)

#### Response (200 OK)
```json
{
  "success": true,
  "data": {
    "stats": {
      "totalRoles": 5,
      "totalPermissions": 116,
      "assignedUsers": 10
    },
    "items": [
      {
        "id": "super-admin",
        "name": "Super Admin",
        "description": "Full platform access — all modules, settings and administrator management.",
        "permittedModules": [
          "overview",
          "users",
          "trip-operations",
          "verification",
          "route-management",
          "finance",
          "safety",
          "support",
          "administration",
          "settings"
        ],
        "modulePermissions": {
          "overview": { "create": true, "read": true, "update": true, "delete": true },
          "users": { "create": true, "read": true, "update": true, "delete": true },
          "finance": { "create": true, "read": true, "update": true, "delete": true },
          "administration": { "create": true, "read": true, "update": true, "delete": true }
        },
        "permissionsCount": 40,
        "assignedAdminsCount": 1
      },
      {
        "id": "finance-admin",
        "name": "Finance Admin",
        "description": "Wallets, payouts, reconciliation, adjustments and financial audit logs.",
        "permittedModules": [
          "overview",
          "finance"
        ],
        "modulePermissions": {
          "overview": { "create": false, "read": true, "update": false, "delete": false },
          "finance": { "create": true, "read": true, "update": true, "delete": true }
        },
        "permissionsCount": 5,
        "assignedAdminsCount": 3
      }
    ]
  }
}
```

---

### 3.2 Create Custom Role
Defines a new administrative role with scoped module access and CRUD permissions.

* **Endpoint:** `POST /api/v1/admin/roles`
* **Auth Required:** Yes (`Bearer <token>`)

#### Request Body
```json
{
  "name": "Compliance Officer",
  "description": "Reviews driver documents and monitors user compliance records.",
  "permittedModules": [
    "overview",
    "verification",
    "users"
  ],
  "modulePermissions": {
    "overview": { "create": false, "read": true, "update": false, "delete": false },
    "verification": { "create": true, "read": true, "update": true, "delete": false },
    "users": { "create": false, "read": true, "update": true, "delete": false }
  }
}
```

#### Validation Rules
* `name`: Required, unique string.
* `description`: Required, non-empty description.
* `permittedModules`: Array of valid module IDs.
* `modulePermissions`: Optional map of CRUD booleans per module. If omitted, default to full CRUD for permitted modules.

#### Response (201 Created)
```json
{
  "success": true,
  "message": "Role created successfully.",
  "data": {
    "id": "compliance-officer",
    "name": "Compliance Officer",
    "description": "Reviews driver documents and monitors user compliance records.",
    "permittedModules": [
      "overview",
      "verification",
      "users"
    ],
    "permissionsCount": 6,
    "assignedAdminsCount": 0
  }
}
```

---

### 3.3 Update Role
Updates an existing role's name, description, and module permissions.

* **Endpoint:** `PUT /api/v1/admin/roles/{id}`
* **Auth Required:** Yes (`Bearer <token>`)

#### Request Body
```json
{
  "name": "Senior Compliance Officer",
  "description": "Full compliance approvals, user sanctions, and document reviews.",
  "permittedModules": [
    "overview",
    "verification",
    "users"
  ],
  "modulePermissions": {
    "overview": { "create": false, "read": true, "update": false, "delete": false },
    "verification": { "create": true, "read": true, "update": true, "delete": true },
    "users": { "create": false, "read": true, "update": true, "delete": false }
  }
}
```

#### Response (200 OK)
```json
{
  "success": true,
  "message": "Role updated successfully."
}
```

---

### 3.4 Assign Admin to Role
Reassigns an administrator user to a specific role.

* **Endpoint:** `POST /api/v1/admin/roles/{id}/assign`
* **Auth Required:** Yes (`Bearer <token>`)

#### Path Parameters
* `id` (`string`): The role ID or role name slug (e.g. `finance-admin`).

#### Request Body
```json
{
  "adminId": "ADM-1004"
}
```

#### Response (200 OK)
```json
{
  "success": true,
  "message": "Administrator successfully assigned to role.",
  "data": {
    "adminId": "ADM-1004",
    "newRole": "Finance Admin"
  }
}
```

---

### 3.5 Delete Role
Deletes a custom role.

* **Endpoint:** `DELETE /api/v1/admin/roles/{id}`
* **Auth Required:** Yes (`Bearer <token>`)

#### Constraint & Foreign Key Guard
A role that is **currently assigned to one or more admin users cannot be deleted**. Administrators must be reassigned first.

#### Response (200 OK)
```json
{
  "success": true,
  "message": "Role deleted successfully."
}
```

#### Error (409 Conflict)
```json
{
  "success": false,
  "error": {
    "code": "ROLE_IN_USE",
    "message": "Cannot delete 'Finance Admin' — 3 admins still assigned to it. Reassign them first."
  }
}
```

---

## 4. Activity Logs (Audit Trail)

### 4.1 List Activity Logs
Retrieves the centralized audit trail of administrative actions across all system modules.

* **Endpoint:** `GET /api/v1/admin/activity-logs`
* **Auth Required:** Yes (`Bearer <token>`)

#### Query Parameters
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `search` | `string` | No | Search query across `actor`, `action`, or `target` ID. |
| `actor` | `string` | No | Filter by administrator name (e.g., `Akosua Buabeng`). |
| `module` | `string` | No | Filter by module name (e.g., `Finance`, `Verification`, `Users`). |
| `result` | `string` | No | Filter by outcome: `Success` or `Failed`. |
| `target` | `string` | No | Filter by target entity ID (e.g., `WDR-9540`, `ADM-1002`). |
| `startDate`| `string` | No | ISO 8601 start timestamp filter. |
| `endDate` | `string` | No | ISO 8601 end timestamp filter. |
| `page` | `integer`| No | Current page number (Default: `1`). |
| `limit` | `integer`| No | Items per page (Default: `10`). |

#### Response (200 OK)
```json
{
  "success": true,
  "data": {
    "stats": {
      "total": 30,
      "success": 24,
      "failed": 6,
      "actors": 7
    },
    "pagination": {
      "page": 1,
      "limit": 10,
      "totalPages": 3,
      "totalItems": 30
    },
    "items": [
      {
        "id": "ACT-6210",
        "time": "Aug 7, 08:00 AM",
        "timestamp": "2026-08-07T08:00:00Z",
        "actor": "Akosua Buabeng",
        "action": "Approved payout",
        "module": "Finance",
        "target": "WDR-9540",
        "ipAddress": "41.66.100.1",
        "result": "Success"
      },
      {
        "id": "ACT-6209",
        "time": "Aug 7, 08:07 AM",
        "timestamp": "2026-08-07T08:07:00Z",
        "actor": "Kwame Appiah",
        "action": "Suspended user account",
        "module": "Users",
        "target": "RID-1045",
        "ipAddress": "41.67.101.2",
        "result": "Success"
      },
      {
        "id": "ACT-6208",
        "time": "Aug 7, 08:14 AM",
        "timestamp": "2026-08-07T08:14:00Z",
        "actor": "Esi Danso",
        "action": "Rejected refund request",
        "module": "Finance",
        "target": "ADM-1003",
        "ipAddress": "41.68.102.3",
        "result": "Failed"
      }
    ]
  }
}
```

---

### 4.2 Get Single Activity Log Detail
Fetches detailed audit record metadata for deep inspection.

* **Endpoint:** `GET /api/v1/admin/activity-logs/{id}`
* **Auth Required:** Yes (`Bearer <token>`)

#### Path Parameters
* `id` (`string`): The activity log ID (e.g., `ACT-6210`).

#### Response (200 OK)
```json
{
  "success": true,
  "data": {
    "id": "ACT-6210",
    "time": "Aug 7, 08:00 AM",
    "timestamp": "2026-08-07T08:00:00Z",
    "actor": "Akosua Buabeng",
    "actorEmail": "a.buabeng@nframa.com",
    "action": "Approved payout",
    "module": "Finance",
    "target": "WDR-9540",
    "targetType": "WithdrawalRequest",
    "ipAddress": "41.66.100.1",
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "result": "Success",
    "metadata": {
      "amount": 450.00,
      "currency": "GHS",
      "payoutMethod": "MTN Mobile Money"
    }
  }
}
```

---

## 5. Standard Error Schemas

Errors follow the uniform Nframa API error format:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE_STRING",
    "message": "Human-readable explanation of the error.",
    "details": null,
    "timestamp": "2026-09-23T21:20:00Z"
  }
}
```

### Common HTTP Status Codes
| Status Code | Code Constant | When Triggered |
| :--- | :--- | :--- |
| `400 Bad Request` | `VALIDATION_ERROR` | Required fields missing, passwords don't match, or bad input. |
| `401 Unauthorized`| `UNAUTHORIZED` | Missing or expired Bearer token. |
| `403 Forbidden` | `INSUFFICIENT_PERMISSIONS` | Authenticated user lacks `administration` write privileges. |
| `404 Not Found` | `RESOURCE_NOT_FOUND` | Admin ID, Role ID, or Activity Log ID does not exist. |
| `409 Conflict` | `ROLE_IN_USE` | Attempted to delete a role currently assigned to admin users. |
| `409 Conflict` | `EMAIL_ALREADY_EXISTS` | Attempted to invite an admin with an email already registered. |
| `500 Internal Error`| `SERVER_ERROR` | Unexpected backend or database exception. |
