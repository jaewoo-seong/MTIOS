# Recommended research API keys

Keep this first release small. Add keys to the app service's environment secrets, then register the environment-variable name in **Settings → AI Analytics → Research provider accounts**. Never paste the secret value into a project, prompt, document, or provider-account label.

## Essential

| Environment variable | Region | Get it from | Used for |
| --- | --- | --- | --- |
| `TAVILY_API_KEY`, `TAVILY_API_KEY_BACKUP`, `TAVILY_API_KEY_3` | Global | [Tavily](https://docs.tavily.com/documentation/quickstart) | Three ordered personal-account slots for broad company and news discovery. The pool advances after quota or rate-limit failures. |
| `FIRECRAWL_API_KEY`, `FIRECRAWL_API_KEY_2`, `FIRECRAWL_API_KEY_3` | Global | [Firecrawl](https://docs.firecrawl.dev/introduction) | Three ordered personal-account slots for focused official-company-site extraction during dossier work. |
| `OPENDART_API_KEY` | Korea | [OpenDART](https://opendart.fss.or.kr/intro/main.do) | Korean corporate identity, filings, financials, ownership, executives, and material events. Automatically used for Korean dossiers when configured. |
| `KOREAN_PUBLIC_DATA_SERVICE_KEY` | Korea | [Public Data Portal](https://www.data.go.kr/en/index.do) | One portal key; apply separately to the National Tax Service business-status API and KONEPS datasets. Business status is automatically checked when a dossier has a 10-digit business number. |
| `CENSUS_API_KEY` | United States | [U.S. Census](https://api.census.gov/data/key_signup.html) | U.S. industry and regional market context. Census now requires a key for data API queries. |

## Useful when the project needs it

| Environment variable | Region | Get it from | Used for |
| --- | --- | --- | --- |
| `SAM_GOV_API_KEY` | United States | [SAM.gov](https://open.gsa.gov/api/entity-api/) | Federal-contractor and registered-entity verification. Automatically used only for U.S. dossiers. A basic non-federal personal key has a small daily allowance, so configure its real quota. |
| `KOSIS_API_KEY` | Korea | [KOSIS](https://kosis.kr/openapi/index/index.jsp) | Korean regional, industry, population, and labor-market context. |
| `FRED_API_KEY` | United States | [FRED](https://fred.stlouisfed.org/docs/api/api_key.html) | Economic and industry context; not company identity. |

## No key required

| Provider | Region | Used for |
| --- | --- | --- |
| [SEC EDGAR](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) | United States and foreign SEC filers | Filings and XBRL data. Automatically searched for U.S. dossiers. |
| [GLEIF API](https://www.gleif.org/en/lei-data/gleif-api) | Global | Legal-entity identity, LEI records, names, addresses, and ownership relationships. Automatically checked once per dossier. |
| [World Bank API](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392) | Global | Country and market context. |

## Deliberately deferred

- KIPRIS and Work24 are valuable, but their access and response handling are more specialized. Add them after the essential Korean identity/filing path is stable.
- NICE, KoDATA, OpenCorporates, and similar commercial sources should wait until pricing, retention, and redistribution rights are approved.
- NAVER API HUB should be added only when its search-result display and storage terms fit the dossier workflow.
