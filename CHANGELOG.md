## [0.1.0] - 2026-05-17

### Added

- Initial release. Shared wizard primitives (`useWizardSteps`, `WizardProgress`, `WizardNavigation`, `WizardOptionCard`, `WizardReviewList`) and a US household draft contract with blank initial state, state-filtered county dropdown data, legacy filing-status normalization, and adapters to the PolicyEngine V1 household creation payload.

### Changed

- Switch to unscoped name. Nikhil cannot recover @policyengine npm org access; per his suggestion in PolicyEngine/policyengine-app-v2#1044 thread, the package now publishes as `policyengine-household-wizard`.
