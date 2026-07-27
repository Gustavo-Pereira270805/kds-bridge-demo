import streamlit as st
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db import run_query as get_dataframe

st.set_page_config(page_title="SLA - KDS Bridge", page_icon="⏱️")
st.title("⏱️ Estouros de SLA")

col1, col2 = st.columns(2)

with col1:
    days = st.slider("Período (dias)", min_value=7, max_value=90, value=30)

breach_df = get_dataframe(
    """
    SELECT
      CASE WHEN sla_breached_cozinha THEN 'Cozinha'
           WHEN sla_breached_salao THEN 'Salão'
      END AS responsavel,
      COUNT(*)::int AS total_estouros,
      ROUND(AVG(COALESCE(sla_breach_minutes_cozinha, sla_breach_minutes_salao)), 1) AS media_min_excedidos
    FROM demands
    WHERE (sla_breached_cozinha OR sla_breached_salao)
      AND created_at >= NOW() - (%s::text || ' days')::INTERVAL
    GROUP BY responsavel
    """,
    params=[str(days)]
)

st.subheader("Estouros de SLA por Responsável")

if breach_df.empty:
    st.info("Nenhum estouro de SLA registrado no período.")
else:
    col1, col2 = st.columns(2)
    with col1:
        st.metric("Total de Estouros", breach_df["total_estouros"].sum())
        st.dataframe(breach_df, use_container_width=True)

    with col2:
        if not breach_df.empty:
            st.bar_chart(breach_df.set_index("responsavel")["total_estouros"])

st.markdown("---")
st.subheader("Ocupação Atual das Filas")

occupation_df = get_dataframe(
    """
    SELECT
      ks.name AS estacao,
      COALESCE(COUNT(*) FILTER (WHERE d.status = 'pending'), 0)::int AS demandas_pendentes_agora,
      ks.capacity::int AS capacidade_configurada
    FROM kitchen_stations ks
    LEFT JOIN demands d ON d.kitchen_station_id = ks.id
    GROUP BY ks.name, ks.capacity
    ORDER BY ks.name
    """
)

if not occupation_df.empty:
    for _, row in occupation_df.iterrows():
        pct = (row["demandas_pendentes_agora"] / row["capacidade_configurada"] * 100) if row["capacidade_configurada"] > 0 else 0
        color = "green" if pct < 50 else ("orange" if pct < 80 else "red")
        st.metric(
            label=f"**{row['estacao']}** (Capacidade: {row['capacidade_configurada']})",
            value=f"{row['demandas_pendentes_agora']} pendentes",
            delta=f"{pct:.0f}% ocupado"
        )

st.markdown("---")
st.caption("KDS Bridge v2.1 — Analytics")
