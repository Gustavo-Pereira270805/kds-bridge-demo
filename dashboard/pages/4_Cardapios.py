import streamlit as st
import plotly.express as px
import pandas as pd
from db import run_query

st.title("Análise por Turno")

turnos = run_query(
    """SELECT
         CASE
           WHEN EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN 6 AND 11 THEN 'Manhã'
           WHEN EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN 12 AND 14 THEN 'Almoço'
           WHEN EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN 15 AND 17 THEN 'Tarde'
           ELSE 'Jantar'
         END AS turno,
         ROUND(AVG(EXTRACT(EPOCH FROM (ready_at - created_at))/60), 1) AS tempo_medio_min,
         COUNT(*)::int AS total
       FROM demands
       WHERE status IN ('ready','retrieved')
       GROUP BY turno
       ORDER BY
         CASE
           WHEN EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN 6 AND 11 THEN 1
           WHEN EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN 12 AND 14 THEN 2
           WHEN EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN 15 AND 17 THEN 3
           ELSE 4
         END"""
)

if not turnos.empty:
    col1, col2 = st.columns(2)

    with col1:
        st.subheader("Métricas por Turno")
        st.dataframe(turnos, use_container_width=True, hide_index=True)

    with col2:
        st.subheader("Tempo Médio por Turno")
        fig = px.bar(
            turnos,
            x="turno",
            y="tempo_medio_min",
            color="turno",
            labels={"turno": "Turno", "tempo_medio_min": "Tempo Médio (min)"},
        )
        st.plotly_chart(fig, use_container_width=True)
else:
    st.info("Sem dados de demandas concluídas.")
