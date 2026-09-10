# Fictional forecast contract

Write `forecast.csv` with these columns: `month`, `customers`, `price_usd`, `revenue_usd`, `cost_usd`, `marketing_spend_usd`, and `operating_contribution_usd`.

Use the supplied fictional assumptions. Revenue is customers times price. Cost is customers times variable cost per customer. Operating contribution is revenue minus cost and marketing spend. For a competitor revision, use the supplied `original-forecast.csv` as the baseline. Preserve that attachment and the prior session workspace. Write the revised `forecast.csv` in this fresh workspace and state the customer-growth reduction in percentage points.

Start October at 120 customers. For each later month, round the prior month's customers times `1 + monthly_customer_growth - monthly_churn` to the nearest whole customer. Round money to two decimal places.
