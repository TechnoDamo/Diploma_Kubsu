# Corporate Security Manual

## 1. Purpose and Scope

This manual defines the baseline security expectations for all business units, subsidiaries, shared-service teams, and third-party operators acting on behalf of the company. The document is written for managers, system owners, engineers, analysts, and operational staff who must understand the controls that govern access, data handling, incident reporting, endpoint protection, privileged administration, and audit readiness. The manual is intentionally practical: each section ties a policy statement to an operating expectation, a monitoring expectation, and an exception-management expectation.

The scope covers headquarters operations, regional offices, remote work, cloud infrastructure, internal software platforms, customer-facing applications, analytics systems, supplier portals, corporate collaboration tooling, and managed service providers that process or access corporate information. Where local law or customer contract requires a stricter control, the stricter requirement prevails. Where a team cannot meet a stated control immediately, it must document compensating controls, risk acceptance, a named owner, and a remediation deadline.

Security controls are grouped into domains so that teams can assess readiness incrementally without losing system-level coherence. Identity management, endpoint management, logging, network protections, change control, resilience, and vendor governance are treated as interdependent layers rather than isolated checklists. Audit evidence must therefore demonstrate not only that a control exists on paper, but also that the control is operating, monitored, and reviewed.

<div style="page-break-after: always;"></div>

## 2. Identity and Access Management

Every user identity must be uniquely attributable to one individual or service purpose. Shared human accounts are prohibited. New user access must be approved by a documented manager or system owner, and privileged access must require a second approval from a security or platform administrator. Access reviews must occur at least quarterly for administrative roles and at least semi-annually for standard business roles.

Multi-factor authentication is mandatory for all external access, all cloud consoles, all administrative interfaces, and any application that stores regulated, confidential, or customer-provided data. Password-only access is not permitted for production administration. Service accounts must be non-interactive wherever technically possible, and their credentials must be stored in an approved secrets-management solution rather than in source code, CI variables without scope control, or local configuration files.

Joiner, mover, and leaver events must be processed through a defined workflow. HR or the authoritative people system must trigger identity lifecycle actions. Terminated users must lose access by the end of the business day, and urgent terminations must be disabled immediately. Role changes must be reviewed for privilege creep. Dormant accounts that have not been used for ninety days must be disabled unless a documented business reason exists.

Access exceptions must be time-bound and ticketed. Emergency access may be granted for incident response, urgent recovery, or legal hold activities, but the request must include purpose, approver, start time, end time, and retrospective review. Exception records must be searchable and retained for audit.

<div style="page-break-after: always;"></div>

## 3. Endpoint and Workspace Protection

All corporate laptops and workstations must be enrolled in centralized device management. Minimum requirements include full-disk encryption, screen-lock enforcement, anti-malware or endpoint detection coverage, current operating-system patching, and centrally managed configuration baselines. Devices that fall materially behind patch policy must be quarantined or denied access to core business services until remediated.

Bring-your-own-device access is limited to approved use cases and only through managed application channels that enforce encryption and remote wipe where legally permitted. Local administrator privileges for general users are prohibited unless explicitly justified and reviewed. USB mass-storage access must be controlled. Sensitive data must not be stored unencrypted on removable media.

Remote work must be treated as a normal operating mode rather than an exception. Home and travel environments require the same identity and device controls as office networks. Employees must report loss, theft, or suspected compromise of devices immediately. Travel to higher-risk jurisdictions may require travel-only devices, reduced data sets, and post-travel forensic review.

Printing, physical note handling, and video-call privacy remain part of the endpoint domain because physical exposure frequently undermines digital control. Teams handling customer, financial, or personnel data must ensure confidential documents are not left unattended, and video meetings that involve confidential material must use approved collaboration tools with authenticated participants.

<div style="page-break-after: always;"></div>

## 4. Data Classification and Handling

Information is classified into public, internal, confidential, and restricted categories. Data owners are responsible for classification, but platform teams must provide the technical means to apply retention, access, encryption, and monitoring rules. Restricted data includes regulated personal data, payment-related data, high-sensitivity financial planning, material legal strategy, and security secrets.

Confidential and restricted data must be encrypted in transit and at rest. Encryption keys must be rotated and access-controlled. Production data may not be copied into lower environments without masking or formal approval. Where test data is needed, teams should prefer synthetic or anonymized data sets. Data exports must be justified by business purpose and tracked when they contain confidential or restricted content.

Collaboration tools, shared drives, ticketing systems, and messaging platforms must not be treated as generic storage for sensitive records. Business units must know which systems are the systems of record and which are merely collaboration layers. When information is shared externally, recipients, purpose, retention period, and access controls must be known. Links to sensitive data must default to least privilege and must not be public by default.

Data disposal must be verifiable. Deleting a visible file in a user interface is not sufficient evidence that data has been purged from all required layers. Teams must understand backup retention, archive retention, replica retention, and legal-hold controls before promising deletion timelines to customers or regulators.

<div style="page-break-after: always;"></div>

## 5. Logging, Monitoring, and Alerting

Security-relevant systems must emit logs that are timely, attributable, and durable. At minimum, logs must capture authentication events, permission changes, administrative actions, configuration changes, deployment events, data-export actions, security-control changes, and material failures in backup or replication processes. Logs should be centralized wherever practical so that correlation and incident investigation do not depend on ephemeral local storage.

Retention periods must match risk and regulatory obligations. Security logs for core production systems should generally be retained for at least twelve months, with at least ninety days of hot-search capability for investigative efficiency. Tamper resistance is required for privileged logs. Administrators of a monitored system should not be able to silently remove or rewrite evidence without detection.

Alerting must be tuned to prioritize actionability. High-volume unactionable alerts create operational blindness. Security engineering and platform operations should maintain a documented runbook for the critical alert classes, including identity anomalies, malware detections, unexpected public exposure, secrets leakage, anomalous data transfer, and integrity failures in backups or pipelines.

Review cadence matters as much as collection. Each critical control area should have an owner who reviews metrics, false positives, open exceptions, and trend changes. Where a control is not yet instrumented, that gap itself must be visible in the risk register rather than implied away.

<div style="page-break-after: always;"></div>

## 6. Change Control and Secure Delivery

All production changes must be attributable to an approved change record, pull request, or deployment workflow. The company should not rely on memory or informal chat messages to explain why production changed. Source control must protect the mainline with review requirements proportionate to risk. Security-sensitive code paths such as authentication, authorization, billing, data export, and cryptographic handling require reviewers with relevant domain competence.

Build pipelines must be reproducible and auditable. The artifact deployed to production should be traceable to source, dependency state, and build configuration. Secrets used in build or deployment must come from an approved secret store. Direct production changes made outside normal pipelines are exceptional events and must be logged, explained, and remediated with process improvement if they recur.

Dependency management must include inventory, update cadence, and emergency response. Teams should know what third-party components they run, what business services depend on them, and how quickly they can patch high-severity vulnerabilities. Open-source usage policy should define approval routes for licenses, support expectations, and end-of-life handling.

Operational resilience is part of secure delivery. Rollback plans, feature flags, canary deployments, and monitoring checkpoints all reduce the blast radius of defective or unsafe changes. Teams should treat recoverability as a first-class engineering property, not a post-incident wish.

<div style="page-break-after: always;"></div>

## 7. Vendor and Third-Party Security

Vendors that process corporate or customer data, connect to internal systems, or materially affect business operations must be reviewed before onboarding and reviewed periodically thereafter. The review should consider service scope, hosting model, subcontracting, identity model, encryption posture, incident-notification commitments, business continuity capability, and termination support.

Security review depth should match risk. A low-risk SaaS note-taking tool does not require the same diligence as a payroll processor, cloud infrastructure supplier, or customer-support outsourcer. However, every vendor should have a defined owner, a contract record, and a known renewal decision point. No business-critical vendor should remain in use without a current owner.

Vendors must report security incidents that affect the company within defined timeframes. Standard language should require timely notification, root-cause transparency where appropriate, corrective-action commitments, and cooperation during investigation. If a vendor cannot meet core contractual security expectations, the business unit must document the exception and the risk acceptance.

Offboarding a vendor must include access removal, credential rotation where needed, data return or destruction, and verification that integrations no longer expose unnecessary trust paths. Vendor exit is an operational control, not merely a procurement milestone.

<div style="page-break-after: always;"></div>

## 8. Governance, Exceptions, and Review

This manual is reviewed at least annually and whenever there is a significant change in regulatory posture, business model, threat environment, or operating architecture. Security leadership owns the baseline, but every executive sponsor remains accountable for implementation inside their operating area. Exceptions must be explicit, dated, approved, and revisited.

Metrics reported to leadership should include high-risk open exceptions, privileged-access review completion, device compliance, patch aging, critical vulnerability aging, incident response timelines, backup test coverage, and vendor review completion. Metrics without owners and thresholds are noise. Metrics that drive decisions become governance.

The company should aim for a security culture that is disciplined without becoming theatrical. Good security practice is visible in planning, system design, staffing, procurement, onboarding, and everyday operations. If a control is routinely bypassed to get work done, that is evidence of a design or process problem that should be fixed at the system level.
