"use client";

// ECharts 画布封装（T11）：词条局部图谱与全站图谱共用。
// - echarts 按需注册（graph + tooltip + legend + canvas），组件挂载后才动态 import，
//   不在 SSR 侧求值任何 ECharts 模块；
// - 数据变化走 setOption(notMerge)，画布只初始化一次；
// - locate(termId)：把视口中心移到该节点并放大（全站页搜索定位用），
//   取力导向布局写回的节点坐标（getData().getItemLayout）。

import { useEffect, useImperativeHandle, useRef } from "react";
import type { EChartsType } from "echarts/core";

import {
  UNSCHOOLED_COLOR,
  UNSCHOOLED_LABEL,
  type GraphNode,
  type SiteGraphData,
} from "@/lib/graph-types";

/** 父组件可调用的命令句柄（搜索定位）。 */
export interface GraphCanvasHandle {
  locate: (termId: number) => void;
}

export interface GraphCanvasProps {
  data: Pick<SiteGraphData, "nodes" | "edges" | "schools">;
  /** 画布高度（px） */
  height: number;
  /** 确定性初始布局（局部图谱：root 居中 + 邻居分环），供力导向收敛 */
  initialPositions?: Map<number, { x: number; y: number }>;
  onNodeClick?: (node: GraphNode) => void;
  ariaLabel: string;
  ref?: React.Ref<GraphCanvasHandle>;
}

const SERIES_ID = "terms-graph";
/** 搜索定位时的放大倍率。 */
const LOCATE_ZOOM = 1.8;

/** locate() 需要的 series model 切面（getModel 相关字段在 ECharts 类型里标 private，运行时公开）。 */
interface SeriesModelLike {
  getData: () => { getItemLayout: (i: number) => unknown };
  coordinateSystem: { dataToPoint: (point: number[]) => number[] } | null | undefined;
}

/** 节点尺寸：热度开方缩放，封顶避免大枢纽吞掉画布。 */
function symbolSize(node: GraphNode): number {
  return Math.min(44, 8 + Math.sqrt(node.heat) * 5);
}

function buildOption(
  data: Pick<SiteGraphData, "nodes" | "edges" | "schools">,
  opts: { initialPositions?: Map<number, { x: number; y: number }> },
) {
  const categoryByName = new Map<string, number>();
  const categories = [
    ...data.schools.map((school) => ({ name: school.title, itemStyle: { color: school.color } })),
    { name: UNSCHOOLED_LABEL, itemStyle: { color: UNSCHOOLED_COLOR } },
  ];
  categories.forEach((category, index) => categoryByName.set(category.name, index));
  const schoolNameById = new Map(data.schools.map((school) => [school.id, school.title]));
  const unschooledCategory = categories.length - 1;

  return {
    tooltip: {
      trigger: "item" as const,
      formatter: (params: { dataType: string; data: Record<string, unknown> }) => {
        if (params.dataType !== "node") return "";
        const d = params.data as {
          title: string;
          heat: number;
          perspectiveCount: number;
          schoolName: string;
        };
        // ECharts accepts an HTMLElement: keep formatting static and put every
        // content field in a text node, including names saved before this fix.
        const tooltip = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = d.title;
        tooltip.append(
          title,
          document.createElement("br"),
          document.createTextNode(`${d.schoolName} · ${d.perspectiveCount} 个视角`),
          document.createElement("br"),
          document.createTextNode(`双链热度 ${d.heat}`),
        );
        return tooltip;
      },
    },
    series: [
      {
        id: SERIES_ID,
        type: "graph" as const,
        layout: "force" as const,
        roam: true,
        draggable: true,
        categories,
        data: data.nodes.map((node) => {
          const schoolName = node.schoolId
            ? (schoolNameById.get(node.schoolId) ?? UNSCHOOLED_LABEL)
            : UNSCHOOLED_LABEL;
          return {
            id: String(node.id),
            name: node.title,
            title: node.title,
            heat: node.heat,
            perspectiveCount: node.perspectiveCount,
            schoolName,
            category: categoryByName.get(schoolName) ?? unschooledCategory,
            symbolSize: symbolSize(node),
            url: node.url,
            ...(opts.initialPositions?.get(node.id) ?? {}),
          };
        }),
        links: data.edges.map((edge) => ({
          source: String(edge.source),
          target: String(edge.target),
          value: edge.weight,
          lineStyle: { width: Math.min(4, 1 + Math.log2(edge.weight)) },
        })),
        force: {
          repulsion: 220,
          edgeLength: [30, 120],
          gravity: 0.06,
          initLayout: "circular" as const,
          // 同步布局：首帧即最终坐标——搜索定位不再受布局动画漂移影响
          layoutAnimation: false,
        },
        label: {
          show: true,
          position: "right" as const,
          fontSize: 11,
          color: "inherit",
        },
        labelLayout: { hideOverlap: true },
        emphasis: {
          focus: "adjacency" as const,
          scale: 1.4,
          label: { show: true },
        },
        lineStyle: { color: "source", opacity: 0.25, curveness: 0.08 },
        itemStyle: { borderColor: "#ffffff", borderWidth: 1 },
      },
    ],
  };
}

export function GraphCanvas({
  data,
  height,
  initialPositions,
  onNodeClick,
  ariaLabel,
  ref,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  // 最新数据/回调经 ref 进入初始化回调与点击回调（import 完成可能早于首个数据 effect）
  const dataRef = useRef(data);
  const optionExtrasRef = useRef({ initialPositions });
  const onNodeClickRef = useRef(onNodeClick);
  // 画布未就绪时的待应用 option（初始化完成后补投，避免竞态丢渲染）
  const pendingOptionRef = useRef<ReturnType<typeof buildOption> | null>(null);

  // 每次渲染后同步 ref：回调/参数身份变化不得触发画布 option 重置
  // （否则父组件重渲染（如定位状态更新）会重置视口与力导向布局）
  useEffect(() => {
    dataRef.current = data;
    optionExtrasRef.current = { initialPositions };
    onNodeClickRef.current = onNodeClick;
  });

  // 初始化一次：动态 import + 注册 + 首次 setOption + 事件绑定 + 自适应尺寸
  useEffect(() => {
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;

    void (async () => {
      const [
        { init, use },
        { GraphChart },
        { TooltipComponent },
        { CanvasRenderer },
      ] = await Promise.all([
        import("echarts/core"),
        import("echarts/charts"),
        import("echarts/components"),
        import("echarts/renderers"),
      ]);
      use([GraphChart, TooltipComponent, CanvasRenderer]);
      if (disposed || !containerRef.current) return;

      const chart = init(containerRef.current);
      chart.setOption(buildOption(dataRef.current, optionExtrasRef.current));
      chart.on("click", (params) => {
        if (params.dataType !== "node" || !onNodeClickRef.current) return;
        const payload = params.data as { id?: string };
        const node = dataRef.current.nodes.find((n) => String(n.id) === payload.id);
        if (node) onNodeClickRef.current(node);
      });
      chartRef.current = chart;
      if (pendingOptionRef.current) {
        chart.setOption(pendingOptionRef.current, { notMerge: true });
        pendingOptionRef.current = null;
      }

      resizeObserver = new ResizeObserver(() => chart.resize());
      resizeObserver.observe(containerRef.current);
    })();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  // 数据变化：整体替换 option（不重建画布；画布未就绪时暂存待补投）。
  // 只依赖数据身份：onNodeClick 每次渲染都是新函数，若作为依赖会在
  // 定位（父组件 setLocated 触发重渲染）后立刻重置视口，定位失效。
  useEffect(() => {
    const option = buildOption(data, { initialPositions });
    if (chartRef.current) {
      chartRef.current.setOption(option, { notMerge: true });
      pendingOptionRef.current = null;
    } else {
      pendingOptionRef.current = option;
    }
  }, [data, initialPositions]);

  useImperativeHandle(
    ref,
    () => ({
      // 每次定位独立的自旋预算（约 3 秒）：画布初始化/布局未就绪时等待重试，
      // 预算耗尽静默放弃（不抛错——定位是渐进增强交互）
      locate(termId: number) {
        let retries = 10;
        const attempt = () => {
          const chart = chartRef.current;
          if (!chart) {
            if (retries-- > 0) setTimeout(attempt, 300);
            return;
          }
          const index = dataRef.current.nodes.findIndex((n) => n.id === termId);
          if (index === -1) return;
          // 力导向布局把节点坐标写回 data item layout（本组件关闭布局动画，
          // setOption 后即可用）。getItemLayout 返回 [x, y] 数组。
          // getModel 在类型里标 private（运行时公开且为例行做法）。
          const seriesModel = (
            chart as unknown as {
              getModel: () => {
                getSeriesByIndex: (i: number) => SeriesModelLike;
              };
            }
          )
            .getModel()
            .getSeriesByIndex(0);

          /** 实测节点当前像素位置；布局/坐标系未就绪返回 null。
           *  seriesModel.coordinateSystem 在每次视口更新后会被整体替换，必须每次重读。 */
          const readPixel = (): [number, number] | null => {
            const coordSys = seriesModel.coordinateSystem;
            const layout = seriesModel.getData().getItemLayout(index) as
              | [number, number]
              | null
              | undefined;
            if (
              !coordSys ||
              !layout ||
              typeof layout[0] !== "number" ||
              typeof layout[1] !== "number"
            ) {
              return null;
            }
            const pixel = coordSys.dataToPoint(layout);
            if (!pixel || typeof pixel[0] !== "number" || typeof pixel[1] !== "number") {
              return null;
            }
            return [pixel[0], pixel[1]];
          };

          const layout0 = seriesModel.getData().getItemLayout(index) as
            | [number, number]
            | null
            | undefined;
          if (!layout0 || typeof layout0[0] !== "number" || typeof layout0[1] !== "number") {
            if (retries-- > 0) setTimeout(attempt, 300);
            return;
          }
          // 视口聚焦：setOption 设 center/zoom（按布局坐标居中 + 放大），
          // 再用 graphRoam 的像素增量做实测校正，消除 center 语义的残余偏差。
          chart.setOption({
            series: [{ id: SERIES_ID, center: [layout0[0], layout0[1]], zoom: LOCATE_ZOOM }],
          });
          for (let round = 0; round < 3; round++) {
            const pixel = readPixel();
            if (!pixel) break;
            const dx = chart.getWidth() / 2 - pixel[0];
            const dy = chart.getHeight() / 2 - pixel[1];
            if (Math.abs(dx) < 2 && Math.abs(dy) < 2) break;
            chart.dispatchAction({ type: "graphRoam", seriesId: SERIES_ID, dx, dy });
          }
          chart.dispatchAction({ type: "highlight", seriesId: SERIES_ID, dataIndex: index });
          chart.dispatchAction({ type: "showTip", seriesId: SERIES_ID, dataIndex: index });
          // 定位已生效的可观察标记（测试/无障碍读屏可用）
          if (containerRef.current) containerRef.current.dataset.located = String(termId);
        };
        attempt();
      },
    }),
    [],
  );

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={ariaLabel}
      data-testid="graph-canvas"
      style={{ height, width: "100%" }}
    />
  );
}

/** 局部图谱的确定性初始布局：root 居中，1/2 跳邻居按环分布（力导向由此收敛）。 */
export function ringPositions(
  nodes: { id: number }[],
  rootId: number,
  hopsOf: (id: number) => number,
): Map<number, { x: number; y: number }> {
  const positions = new Map<number, { x: number; y: number }>([[rootId, { x: 0, y: 0 }]]);
  const ring1 = nodes.filter((n) => n.id !== rootId && hopsOf(n.id) === 1);
  const ring2 = nodes.filter((n) => n.id !== rootId && hopsOf(n.id) === 2);
  for (const [ring, radius, phase] of [
    [ring1, 180, 0],
    [ring2, 380, 0.35],
  ] as const) {
    ring.forEach((node, i) => {
      const angle = phase + (2 * Math.PI * i) / ring.length;
      positions.set(node.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    });
  }
  return positions;
}
