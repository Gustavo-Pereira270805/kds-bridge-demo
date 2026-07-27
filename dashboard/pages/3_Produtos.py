import streamlit as st
import plotly.express as px
from db import run_query

st.title("Ranking de Produtos")

dias = st.slider("Últimos N dias", min_value=7, max_value=90, value=30)

produtos = run_query(
    """SELECT product_name,
              COUNT(*)::int AS total_demandas,
              ROUND(AVG(EXTRACT(EPOCH FROM (ready_at - created_at))/60), 1) AS tempo_medio_min
       FROM demands
       WHERE status IN ('ready','retrieved')
         AND created_at >= NOW() - INTERVAL '1 day' * %s
       GROUP BY product_name
       ORDER BY total_demandas DESC
       LIMIT 10""",
    [dias],
)

if not produtos.empty:
    col1, col2 = st.columns([2, 3])

    with col1:
        st.subheader("Top 10 Produtos")
        st.dataframe(produtos, use_container_width=True, hide_index=True)

    with col2:
        st.subheader("Demandas por Produto")
        fig = px.bar(
            produtos,
            x="product_name",
            y="total_demandas",
            color="tempo_medio_min",
            labels={
                "product_name": "Produto",
                "total_demandas": "Total",
                "tempo_medio_min": "Tempo Médio (min)",
            },
        )
        fig.update_xaxes(tickangle=45)
        st.plotly_chart(fig, use_container_width=True)
else:
    st.info("Sem dados no período selecionado.")
