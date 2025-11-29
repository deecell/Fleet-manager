# Customer Access Design

> **Purpose**: Summary document for team discussion on how customers will access the Fleet Management Dashboard.

---

## Access Model: Admin-Managed

All provisioning is handled by Deecell Operations through the Admin Dashboard. Customers have view-only access to their fleet data.

### Deecell Operations (Admin Dashboard)
- Create customer organizations
- Create user accounts for customers
- Create fleets for customers
- Add trucks to fleets
- Provision and assign PowerMon devices
- View cross-organization statistics
- Troubleshoot and support customers

### Customer Users (Customer Portal)
- Log in to their organization's dashboard
- View real-time fleet data
- View truck locations and status
- View historical data and charts
- View alerts and notifications
- *(No editing capabilities)*

---

## What Needs to Be Built

### Customer Authentication
| Feature | Description | Effort |
|---------|-------------|--------|
| Customer Login Page | Email/password login at `/login` | Medium |
| Password Reset | Email-based password reset flow | Medium |
| Session Management | Secure session handling for customers | Low |
| Dashboard Access | Connect Fleet Viewer to logged-in user's org | Low |

### Already Built (Admin Dashboard)
- Organization management
- Fleet management
- Truck management
- Device management
- User account creation

---

## User Journey: Customer Onboarding

```
1. Deecell creates Organization in Admin Dashboard
   └── Sets org name, contact info

2. Deecell creates Fleet(s) for customer
   └── Names them (e.g., "Main Fleet")

3. Deecell adds Trucks to fleet
   └── Truck number, driver name, location

4. Deecell provisions PowerMon devices
   └── Assigns device to each truck

5. Deecell creates User account for customer
   └── Sets email, temporary password

6. Customer receives login credentials
   └── (Manual handoff or automated email)

7. Customer logs in
   └── Sees their fleet dashboard with live data
```

---

## New Pages Needed

| Page | Route | Purpose |
|------|-------|---------|
| Customer Login | `/login` | Customer authentication |
| Forgot Password | `/forgot-password` | Password reset request |
| Reset Password | `/reset-password/:token` | Set new password |

The existing Fleet Viewer dashboard (`/`) will be connected to show the logged-in customer's organization data.

---

## Questions for Team Discussion

1. **Welcome Email**: Should we send automated welcome emails, or will Deecell manually share credentials?

2. **Password Policy**: Any requirements for password strength?

3. **Multiple Users per Org**: Can an organization have multiple user accounts? (e.g., fleet manager + drivers)

4. **Future Self-Service**: Should we plan the architecture to support customer self-service later?

---

## Recommended Next Steps

1. **Confirm Approach**: Verify admin-managed model works for business needs
2. **Build Customer Login**: Implement authentication for customers
3. **Connect Dashboard**: Wire Fleet Viewer to show logged-in user's org data
4. **Test End-to-End**: Create test org, users, and verify login flow

---

*Document updated: November 29, 2025*
*Access Model: Admin-Managed (Deecell provisions everything)*
