import streamlit as st
import plotly.express as px
from db import run_query

st.title("Horários de Pico")

dias = st.slider("Últimos N dias", min_value=7, max_value=90, value=30)

horarios = run_query(
    """SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo')::int AS hora,
              COUNT(*) AS total
       FROM demands
       WHERE created_at >= NOW() - INTERVAL '1 day' * %s
       GROUP BY hora ORDER BY hora""",
    [dias],
)

if not horarios.empty:
    fig = px.bar(
        horarios,
        x="hora",
        y="total",
        labels={"hora": "Hora do Dia", "total": "Nº de Demandas"},
    )
    st.plotly_chart(fig, use_container_width=True)

    pico = horarios.loc[horarios["total"].idxmax()]
    st.info(
        f"Horário de pico: **{int(pico['hora'])}h** com **{int(pico['total'])}** demandas"
    )
else:
    st.info("Sem dados no período selecionado.")
