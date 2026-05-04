// ──────────────────────────────────────────────────────────────
// sentinel-os/shell/src/panels/IntelGraph.tsx
// Real D3.js force-directed graph of Neo4j intelligence data
// Queries correlations from API Gateway GraphQL
// ──────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useQuery, gql } from '@apollo/client';
import { apolloClient } from '../lib/graphql';

const GET_CORRELATIONS = gql`
  query GetCorrelations($limit: Int) {
    correlations(limit: $limit) {
      id sourceAlertId targetAlertId correlationType confidence hypothesis createdAt
    }
  }
`;

interface Correlation {
  id: string; sourceAlertId: string; targetAlertId: string;
  correlationType: string; confidence: number; hypothesis: string; createdAt: string;
}

interface GraphNode extends d3.SimulationNodeDatum {
  id: string; label: string; type: string; color: string;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: GraphNode | string; target: GraphNode | string;
  type: string; confidence: number;
}

const TYPE_COLORS: Record<string, string> = {
  ALERT: '#00e5ff', ACTOR: '#d50000', LOCATION: '#ffd600',
  IOC: '#76ff03', CVE: '#ce93d8', DOMAIN: '#ff6f00',
};

export function IntelGraph() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [nodeCount, setNodeCount] = useState(0);

  const { data } = useQuery(GET_CORRELATIONS, {
    variables: { limit: 50 }, client: apolloClient, pollInterval: 30000,
  });

  const correlations: Correlation[] = data?.correlations ?? [];

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = svgRef.current.clientWidth || 600;
    const height = svgRef.current.clientHeight || 400;

    // Build graph from correlations
    const nodeMap = new Map<string, GraphNode>();
    const links: GraphLink[] = [];

    for (const c of correlations) {
      if (!nodeMap.has(c.sourceAlertId)) {
        nodeMap.set(c.sourceAlertId, {
          id: c.sourceAlertId, label: c.sourceAlertId.slice(0, 8),
          type: 'ALERT', color: TYPE_COLORS.ALERT,
        });
      }
      if (!nodeMap.has(c.targetAlertId)) {
        nodeMap.set(c.targetAlertId, {
          id: c.targetAlertId, label: c.targetAlertId.slice(0, 8),
          type: 'ALERT', color: TYPE_COLORS.ALERT,
        });
      }
      links.push({
        source: c.sourceAlertId, target: c.targetAlertId,
        type: c.correlationType, confidence: c.confidence,
      });
    }

    // Add synthetic nodes if no data
    if (nodeMap.size === 0) {
      const synthIds = ['TGT-001', 'ACTOR-A', 'LOC-SYRIA', 'IOC-IP', 'CVE-2024'];
      const synthTypes = ['ALERT', 'ACTOR', 'LOCATION', 'IOC', 'CVE'];
      synthIds.forEach((id, i) => {
        nodeMap.set(id, { id, label: id, type: synthTypes[i], color: TYPE_COLORS[synthTypes[i]] || '#00e5ff' });
      });
      links.push(
        { source: 'TGT-001', target: 'ACTOR-A', type: 'ATTRIBUTED', confidence: 0.8 },
        { source: 'TGT-001', target: 'LOC-SYRIA', type: 'LOCATED', confidence: 0.6 },
        { source: 'TGT-001', target: 'IOC-IP', type: 'USES', confidence: 0.9 },
        { source: 'ACTOR-A', target: 'CVE-2024', type: 'EXPLOITS', confidence: 0.7 },
        { source: 'IOC-IP', target: 'LOC-SYRIA', type: 'RESOLVES', confidence: 0.5 },
      );
    }

    const nodes = Array.from(nodeMap.values());
    setNodeCount(nodes.length);

    const simulation = d3.forceSimulation<GraphNode>(nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(links).id(d => d.id).distance(80))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(25));

    const g = svg.append('g');

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 5])
      .on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(zoom);

    // Links
    const link = g.append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', '#0e2a44')
      .attr('stroke-width', d => Math.max(1, d.confidence * 3))
      .attr('stroke-opacity', 0.6);

    // Link labels
    const linkLabel = g.append('g')
      .selectAll('text')
      .data(links)
      .join('text')
      .attr('fill', '#2e6e87')
      .attr('font-size', '7px')
      .attr('font-family', 'Space Mono')
      .attr('text-anchor', 'middle')
      .text(d => d.type);

    // Nodes
    const dragBehavior = d3.drag<SVGGElement, GraphNode>()
      .on('start', (event: d3.D3DragEvent<SVGGElement, GraphNode, GraphNode>, d: GraphNode) => { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (event: d3.D3DragEvent<SVGGElement, GraphNode, GraphNode>, d: GraphNode) => { d.fx = event.x; d.fy = event.y; })
      .on('end', (event: d3.D3DragEvent<SVGGElement, GraphNode, GraphNode>, d: GraphNode) => { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; });

    const node = g.append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .call(dragBehavior as any);

    (node as any).append('circle')
      .attr('r', 16)
      .attr('fill', (d: GraphNode) => `${d.color}22`)
      .attr('stroke', (d: GraphNode) => d.color)
      .attr('stroke-width', 1.5);

    (node as any).append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('fill', (d: GraphNode) => d.color)
      .attr('font-size', '7px')
      .attr('font-family', 'Space Mono')
      .text((d: GraphNode) => d.label);

    simulation.on('tick', () => {
      link.attr('x1', d => (d.source as GraphNode).x ?? 0)
        .attr('y1', d => (d.source as GraphNode).y ?? 0)
        .attr('x2', d => (d.target as GraphNode).x ?? 0)
        .attr('y2', d => (d.target as GraphNode).y ?? 0);
      linkLabel.attr('x', d => (((d.source as GraphNode).x ?? 0) + ((d.target as GraphNode).x ?? 0)) / 2)
        .attr('y', d => (((d.source as GraphNode).y ?? 0) + ((d.target as GraphNode).y ?? 0)) / 2 - 4);
      (node as any).attr('transform', (d: GraphNode) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => { simulation.stop(); };
  }, [correlations]);

  return (
    <div className="flex flex-col flex-1">
      <div className="panel-header">
        <span className="panel-icon">◈</span> INTEL GRAPH — Neo4j
        <span className="ml-auto text-[9px]" style={{ color: 'var(--text2)' }}>{nodeCount} nodes</span>
      </div>
      <svg ref={svgRef} className="flex-1 w-full" style={{ minHeight: 0 }} />
    </div>
  );
}
