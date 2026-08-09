# Korean company research data-source plan

Public APIs may be publicly available, but their service keys are still private credentials. Keys must be stored server-side, encrypted, redacted from logs, and never placed in browser code, prompts, dossier documents, or source exports.

## Recommended provider order

| Priority | Provider | Access | Use in company research |
| --- | --- | --- | --- |
| 1 | [OpenDART](https://opendart.fss.or.kr/intro/main.do) | Free registration and API key | Corporate identity, filings, financial statements, ownership, executives, major events, and source documents for filing companies. |
| 1 | [National Tax Service business-status API](https://www.data.go.kr/en/data/15081808/openapi.do) | Free Public Data Portal service key | Verify a known business registration number and determine active, suspended, or closed status. It is a verification source, not a broad company-search API. |
| 1 | [KONEPS/Nara Marketplace user information](https://www.data.go.kr/data/15129466/openapi.do) | Free Public Data Portal service key | Confirm registered public-procurement suppliers, business number, address, registered industries, and supplied products. Use the current service rather than retired legacy endpoints. |
| 1 | [KIPRIS Plus](https://plus.kipris.or.kr/eng/main.do) | Account and API access key | Patent, utility model, design, trademark, registration, trial, and applicant-company signals. Useful for technology, product, and innovation sections. |
| 1 | [Work24 Open API](https://www.work24.go.kr/cm/e/a/0110/selectOpenApiIntro.do) | Reviewed application; enterprise-member account | Current recruitment, public recruitment company information, roles, locations, and hiring signals for HR intelligence. Keys cannot be transferred between organizations. |
| 2 | [Kakao Local](https://developers.kakao.com/docs/en/local/dev-guide) | Kakao developer app REST key | Korean address search, geocoding, place/category matching, phone and branch-location evidence. Use as corroboration rather than legal-company identity. |
| 2 | [Korean road-address API](https://www.juso.go.kr/externalLink/goUrl?menuId=DT02) | Approval key | Normalize Korean road, lot, building, and English addresses before identity matching and regional filtering. |
| 2 | [KOSIS Open API](https://kosis.kr/openapi/index/index.jsp) | API key | Regional, industrial, workforce, and demographic context. This supports market analysis and target scoring, not direct company identity. |
| 2 | [NAVER API HUB](https://developers.naver.com/notice/article/32530) | Naver Cloud account and API HUB client credentials | Korean web/news discovery and search-trend context, subject to product terms and result-display restrictions. New Search API applications moved from the old Developer Center to API HUB on July 31, 2026. |
| 3 | [NICE BizAPI](https://openapi.nicebizline.com/) | Commercial contract and test-bed access | Paid, high-confidence corporate, registration, financial, credit-risk, registry-document, and related-company enrichment when public sources are incomplete. |
| 3 | [KoDATA](https://www.kodata.co.kr/cr/CRPRS03R0.do) | Commercial agreement | Paid company/credit database, risk and early-warning enrichment. Confirm API/delivery terms with KoDATA before engineering an adapter. |
| Optional | [SME24 data sharing](https://www.smes.go.kr/main/dbCnrs) | Institutional application and review | SME certificates, accumulated company information, and support-program eligibility where access is approved. This is not a normal self-serve personal key. |

Regional open-data portals and industry-specific Public Data Portal APIs should be added only when a project strategy needs them. They are best used as scoped evidence providers, not as a single general company directory.

## How a supplied key is used

1. The operator adds a provider account in Settings. The browser sends the secret once to a server-only endpoint.
2. The server encrypts the credential and stores only a masked label, owner, environment, approved purpose, quota, and last health-check result alongside it.
3. The research router chooses providers by required dossier field. For example, DART handles filings, Work24 handles hiring, KIPRIS handles IP, and Kakao/Juso handle location verification.
4. A provider adapter performs the request, normalizes the result into claims and source records, and records call count, latency, status, and quota consumption. Raw secrets never reach an AI model.
5. Identity resolution joins evidence using corporate code, business registration number, official domain, normalized Korean/English name, and normalized address. Conflicts are retained and marked for review rather than silently merged.
6. Fresh results are cached by company, endpoint, and parameters. Dossiers receive the normalized claim, retrieval date, source URL or official record identifier, and confidence—not the credential or unfiltered provider response.

## Routing policy

- Discovery starts with search providers and official supplier/company listings, then deduplicates before dossier work begins.
- Verification calls are made only after a candidate has a stable identifier. This prevents wasting DART, tax-status, procurement, IP, and commercial credits on duplicates.
- Each dossier requests only the providers relevant to its strategy and available identifiers.
- Official registries outrank company websites, which outrank reputable news, which outrank search snippets. Conflicts remain visible in the dossier.
- Commercial NICE/KoDATA calls are opt-in fallbacks behind a per-project cost cap.
- Multiple credentials may be configured for reliability or separate authorized organizations only when the provider's terms permit it. They must not be rotated to evade per-account limits.

## Rollout

1. Add a generic encrypted `research_provider_accounts` store, health check, per-key quota ledger, capability metadata, and settings UI. Start with one authorized credential per provider.
2. Implement OpenDART, National Tax Service, KONEPS, KIPRIS Plus, and Kakao/Juso adapters. Add normalized source/claim storage and identity-resolution tests.
3. Add Work24, KOSIS, and NAVER API HUB; route them to HR, market-context, and Korean discovery tasks respectively.
4. Add NICE BizAPI or KoDATA only after pricing, redistribution rights, retention rules, and API contract terms are approved.
5. Add provider coverage, error rate, freshness, calls, quota remaining, and cost to AI Analytics. Alert before exhaustion and fall back to other evidence sources rather than silently weakening a dossier.
