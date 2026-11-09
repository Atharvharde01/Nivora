import React from "react";
import { Chart as ChartJS, ArcElement, Tooltip, Legend, ChartData } from "chart.js";
import { Doughnut } from "react-chartjs-2";

ChartJS.register(ArcElement, Tooltip, Legend);

export interface DoughnutChartProps {
  data: ChartData<"doughnut">;
}

export function DoughnutChart({ data }: DoughnutChartProps): JSX.Element {
  return <Doughnut data={data} />;
}

