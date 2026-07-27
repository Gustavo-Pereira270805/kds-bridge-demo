import streamlit as st
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db import run_query as get_dataframe

st.set_page_config(page_title="Cancelamentos e Zerados - KDS Bridge", page_icon="📋")
st.title("📋 Cancelamentos e Zerados")

days = st.slider("Período (dias)", min_value=7, max_value=90, value=30, key="cancel_days")

st.subheader("Cancelamentos por Origem")

cancellations_df = get_dataframe(
    """
    SELECT
      status AS origem_cancelamento,
      COUNT(*)::int AS total,
      cancel_reason
    FROM demands
    WHERE status IN ('cancelled_salao', 'cancelled_cozinha')
      AND created_at >= NOW() - (%s::text || ' days')::INTERVAL
    GROUP BY status, cancel_reason
    ORDER BY total DESC
    -- annulled are never in cancelled statuses, but explicit filter for safety:
    -- status != 'annulled' implied by IN clause above
    """,
    params=[str(days)]
)

if cancellations_df.empty:
    st.info("Nenhum cancelamento registrado no período.")
else:
    cancellations_df["Origem"] = cancellations_df["origem_cancelamento"].apply(
        lambda x: "Salão" if x == "cancelled_salao" else "Cozinha"
    )

    col1, col2 = st.columns([3, 2])
    with col1:
        st.dataframe(
            cancellations_df[["Origem", "total", "cancel_reason"]].rename(
                columns={"total": "Total", "cancel_reason": "Motivo"}
            ),
            use_container_width=True,
            hide_index=True
        )

    with col2:
        origin_counts = cancellations_df.groupby("Origem")["total"].sum()
        st.bar_chart(origin_counts)

st.markdown("---")
st.subheader("Zerados por Produto")

stockouts_df = get_dataframe(
    """
    SELECT product_name, COUNT(*)::int AS total_roturas
    FROM demands
    WHERE stockout_reported = true AND status != 'annulled'
      AND created_at >= NOW() - (%s::text || ' days')::INTERVAL
    GROUP BY product_name
    ORDER BY total_roturas DESC
    """,
    params=[str(days)]
)

if stockouts_df.empty:
    st.info("Nenhum zerou registrado no período.")
else:
    col1, col2 = st.columns([3, 2])
    with col1:
        st.dataframe(
            stockouts_df.rename(
                columns={"product_name": "Produto",                     "total_roturas": "Zerados"}
            ),
            use_container_width=True,
            hide_index=True
        )

    with col2:
        if not stockouts_df.empty:
            st.bar_chart(stockouts_df.set_index("product_name")["total_roturas"])

st.markdown("---")
st.subheader("Eventos Recentes (demand_events)")

events_df = get_dataframe(
    """
    SELECT
      de.event_type,
      de.actor,
      de.notes,
      de.created_at,
      d.product_name
    FROM demand_events de
    JOIN demands d ON d.id = de.demand_id
    ORDER BY de.created_at DESC
    LIMIT 50
    """
)

if events_df.empty:
    st.info("Nenhum evento registrado.")
else:
    st.dataframe(
        events_df.rename(
            columns={
                "event_type": "Evento",
                "actor": "Ator",
                "notes": "Observações",
                "created_at": "Data/Hora",
                "product_name": "Produto"
            }
        ),
        use_container_width=True,
        hide_index=True
    )

st.markdown("---")
st.caption("KDS Bridge v2.1 — Analytics")
