# AI-Based-Sales-CRM

## Simple Project Flow

```mermaid
flowchart LR
    U[User<br/>Admin / Manager / User]
    F[React Frontend<br/>Login, Dashboards, CRM Modules]
    A[Axios API Layer<br/>JWT Token]
    B[Node.js + Express Backend<br/>Auth, Leads, Clients, Deals,<br/>Followups, Quotations, Events, Reports]
    D[(MongoDB<br/>Users, Leads, Clients, Deals,<br/>Followups, Events, Settings)]
    W[Background Workers<br/>Email Reminders, WhatsApp Meetings,<br/>Google Calendar Sync]
    P[Python AI Services<br/>Followup Priority,<br/>Sales Forecasting]

    U --> F
    F --> A
    A --> B
    B <--> D
    B --> W
    B --> P
    P --> B
    B --> F
```

## Flow Summary

1. Users sign in from the React frontend and access role-based dashboards and CRM modules.
2. The frontend sends requests through Axios to the Express backend using JWT authentication.
3. The backend handles core CRM operations like leads, clients, deals, followups, quotations, events, expenses, and reports.
4. MongoDB stores the main business data and settings used across the system.
5. For smart features, the backend calls Python models for follow-up priority prediction and sales forecasting.
6. Background workers send notifications, WhatsApp reminders, and support calendar-related automation.
