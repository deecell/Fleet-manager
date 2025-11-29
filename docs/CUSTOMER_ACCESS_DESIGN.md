# Customer Access Design Options

> **Purpose**: Summary document for team discussion (Andy, Mary) on how customers will access and use the Fleet Management Dashboard.

---

## Current State

| Component | Status | Who Can Access |
|-----------|--------|----------------|
| Admin Dashboard (`/admin`) | Built | Deecell Operations only |
| Fleet Viewer Dashboard (`/`) | Built | Requires org context (no login yet) |
| Customer Login | Not built | - |
| Customer Self-Service | Not built | - |

---

## Key Questions & Answers

| Question | Answer |
|----------|--------|
| Can customers add their own fleets and trucks? | **Yes** - Customers need to add fleets and trucks |
| Who assigns PowerMon devices to trucks? | **Deecell** - Admin assigns devices |
| Different permissions for user roles? | **Not now** - Maybe in the future |

---

## Recommended Approach: Hybrid Model

Based on the answers above, here's the recommended division of responsibilities:

### Deecell Operations (Admin Dashboard)
- Create customer organizations
- Create initial user accounts for customers
- Provision PowerMon devices in the system
- **Assign PowerMon devices to trucks**
- View cross-organization statistics
- Troubleshoot and support customers

### Customer Users (Customer Portal)
- Log in to their organization's dashboard
- View real-time fleet data (existing Fleet Viewer)
- **Create new fleets** (e.g., "West Coast Fleet", "Night Shift Fleet")
- **Add trucks to fleets** (truck number, driver name, location)
- View historical data and alerts
- *(Future: Manage team members with different roles)*

---

## What Needs to Be Built

### Phase 1: Customer Authentication
| Feature | Description | Effort |
|---------|-------------|--------|
| Customer Login Page | Email/password login at `/login` | Medium |
| Password Reset | Email-based password reset flow | Medium |
| Session Management | Secure session handling for customers | Low |

### Phase 2: Customer Self-Service
| Feature | Description | Effort |
|---------|-------------|--------|
| Fleet Management | Create, edit, delete fleets | Medium |
| Truck Management | Add trucks to fleets, edit truck info | Medium |
| Dashboard Integration | Connect Fleet Viewer to logged-in user's org | Low |

### Phase 3: Future Enhancements (Optional)
| Feature | Description | Effort |
|---------|-------------|--------|
| Role-Based Access | Admin, Manager, Viewer roles within org | High |
| Team Invites | Invite team members via email | Medium |
| Audit Trail | Track who made what changes | Medium |

---

## User Journey: Customer Onboarding

```
1. Deecell creates Organization in Admin Dashboard
   └── Sets org name, contact info, timezone

2. Deecell creates User account for customer
   └── Sets email, temporary password
   └── Assigns to organization

3. Customer receives welcome email
   └── Link to login page
   └── Temporary password

4. Customer logs in for first time
   └── Prompted to change password
   └── Sees empty Fleet Viewer dashboard

5. Customer creates their first Fleet
   └── Names it (e.g., "Delivery Fleet")

6. Customer adds Trucks to fleet
   └── Truck number, driver name, location

7. Deecell provisions PowerMon devices
   └── Ships physical device to customer

8. Deecell assigns device to truck in Admin Dashboard
   └── Links PowerMon serial to truck

9. Customer sees live data flowing!
   └── Dashboard shows real-time metrics
```

---

## UI Mockup: Customer Portal

### Customer Navigation (after login)
```
┌─────────────────────────────────────────────────────┐
│  [Logo] Fleet Dashboard          [User ▼] [Logout]  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐             │
│  │ Fleets  │  │ Trucks  │  │ Alerts  │             │
│  └─────────┘  └─────────┘  └─────────┘             │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │                                             │   │
│  │          Fleet Map / Truck List             │   │
│  │          (existing Fleet Viewer)            │   │
│  │                                             │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### New Pages Needed
| Page | Route | Purpose |
|------|-------|---------|
| Login | `/login` | Customer authentication |
| Forgot Password | `/forgot-password` | Password reset request |
| Reset Password | `/reset-password/:token` | Set new password |
| My Fleets | `/fleets` | List and manage fleets |
| Add Fleet | `/fleets/new` | Create new fleet form |
| Fleet Details | `/fleets/:id` | View/edit fleet, see trucks |
| Add Truck | `/fleets/:id/trucks/new` | Add truck to fleet |

---

## Security Considerations

| Concern | Solution |
|---------|----------|
| Password storage | bcrypt hashing (already in schema) |
| Session security | HTTP-only cookies, secure in production |
| Data isolation | All queries scoped to user's organization |
| Device assignment | Only Deecell admins can assign devices |

---

## Questions for Team Discussion

1. **Welcome Email**: Should we send automated welcome emails, or will Deecell manually share credentials?

2. **Password Policy**: Any requirements for password strength (length, special chars)?

3. **Branding**: Should customers see the Deecell logo, or will this be white-labeled per customer?

4. **First Fleet**: Should Deecell create an initial fleet when onboarding, or let customers start from scratch?

5. **Truck without Device**: Can customers add trucks before a PowerMon is assigned? (Shows "No Device" status)

6. **Edit Restrictions**: Once a device is assigned to a truck, can the customer still edit the truck info?

---

## Recommended Next Steps

1. **Team Discussion**: Review this document, answer the questions above
2. **Design Approval**: Confirm the Hybrid approach works for business needs
3. **Phase 1 Build**: Implement customer authentication (login, password reset)
4. **Phase 2 Build**: Add fleet/truck self-service features
5. **Testing**: Pilot with one customer organization

---

*Document created: November 29, 2025*
*For discussion: Andy, Mary, Sol*
