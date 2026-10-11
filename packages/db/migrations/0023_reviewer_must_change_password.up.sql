-- Content-lead account management (reviewer-account-repository.ts). A
-- content lead creates a panel account, or resets its password, with a
-- temporary password shown to them once; this flag forces the reviewer to
-- replace it on their next login, so the content lead never knows the
-- password the reviewer actually uses.
--
-- Defaults to false: every account that existed before this migration had
-- its password provisioned out of band (setReviewerPassword) and is not
-- retroactively forced through a change.
ALTER TABLE reviewers ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;
