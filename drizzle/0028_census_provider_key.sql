-- Provider accounts are looked up by research provider catalog key. Accounts
-- registered as "census" never matched the catalog key "us_census", so they
-- were silently ignored by the research engine.
UPDATE "research_provider_accounts" SET "provider" = 'us_census' WHERE "provider" = 'census';
