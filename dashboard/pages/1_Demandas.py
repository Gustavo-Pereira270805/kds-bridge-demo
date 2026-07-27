import streamlit as st
import plotly.express as px
from db import run_query
from datetime import date, timedelta

st.title("Resumo de Demandas")

col1, col2 = st.columns(2)
with col1:
    data_inicio = st.date_input("Data início", value=date.today() - timedelta(days=30))
with col2:
    data_fim = st.date_input("Data fim", value=date.today())

total = run_query(
    "SELECT COUNT(*) as total FROM demands WHERE created_at::date BETWEEN %s AND %s",
    [data_inicio, data_fim],
)
media = run_query(
    """SELECT ROUND(AVG(EXTRACT(EPOCH FROM (ready_at - created_at))/60), 1) as media_min
       FROM demands WHERE status IN ('ready','retrieved') AND created_at::date BETWEEN %s AND %s""",
    [data_inicio, data_fim],
)

col1, col2, col3 = st.columns(3)
col1.metric("Total de Demandas", int(total["total"][0]) if not total.empty else 0)
col2.metric("Tempo Médio (min)", media["media_min"][0] if not media.empty else "-")
col3.metric("Período", f"{data_inicio} → {data_fim}")

st.subheader("Demandas por dia")
por_dia = run_query(
    """SELECT created_at::date as dia, COUNT(*) as total
       FROM demands WHERE created_at::date BETWEEN %s AND %s
       GROUP BY dia ORDER BY dia""",
    [data_inicio, data_fim],
)
if not por_dia.empty:
    fig = px.line(por_dia, x="dia", y="total", markers=True)
    st.plotly_chart(fig, use_container_width=True)
else:
    st.info("Sem dados no período selecionado.")
