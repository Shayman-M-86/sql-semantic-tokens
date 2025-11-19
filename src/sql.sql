-
SELECT a.name, SUM(o.total_amt_usd) AS total_sales
FROM accounts a
JOIN orders o ON a.id = o.account_id
GROUP BY a.name
HAVING SUM(o.total_amt_usd) > 10000
ORDER BY total_sales DESC;


