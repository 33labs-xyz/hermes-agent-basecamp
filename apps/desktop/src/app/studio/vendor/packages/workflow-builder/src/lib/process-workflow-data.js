// Pure data-mapping helpers extracted verbatim from NodeFlow.jsx so the
// restore-on-mount contract can be unit-tested without rendering the full
// (reactflow-backed) canvas component. NodeFlow imports these back in rather
// than redefining them, so behavior is unchanged -- this is a relocation,
// not a rewrite.
//
// Root cause this module documents: a workflow-definition object that is
// truthy but has no `.data.nodes` (e.g. the `{ nodes: [], edges: [] }` shape
// WorkflowStudio used to substitute for a FAILED fetch) is not restorable.
// `processWorkflowData` returns `null` for that shape on purpose -- callers
// must treat `null` as "nothing to restore" and clear any loading state
// instead of waiting forever for a restore that will never happen.

import { apiNodeModels } from "../components/utility";

export const edgeStyles = {
  blue: {
    stroke: '#3b82f6', // blue-500
    strokeWidth: 2,
  },
  green: {
    stroke: '#22c55e', // green-500
    strokeWidth: 2,
  },
  orange: {
    stroke: '#f97316', // orange-500
    strokeWidth: 2,
  },
  gray: {
    stroke: '#6b7280', // gray-500
    strokeWidth: 2,
  },
  yellow: {
    stroke: '#eab308', // yellow-500
    strokeWidth: 2,
  },
  white: {
    stroke: '#ffffff',
    strokeWidth: 2,
  }
};

export const getEdgeColor = (sourceHandle, targetHandle, sourceNode = null, targetNode = null) => {
  if (sourceHandle === "apiOutput" && sourceNode) {
    const output = sourceNode.data.outputs?.[0];
    const modelType = sourceNode.data.formValues?.model_type;

    if (output?.type === 'text' || modelType === 'chat') return "blue";
    if (output?.type === 'video_url' || modelType === 'video') return "orange";
    if (output?.type === 'audio_url' || modelType === 'audio') return "yellow";
    return "green";
  }

  if (["textOutput", "concatOutput"].includes(sourceHandle)) return "blue";
  if (["imageOutput"].includes(sourceHandle)) return "green";
  if (["videoOutput"].includes(sourceHandle)) return "orange";
  if (["audioOutput"].includes(sourceHandle)) return "yellow";

  if (["textInput", "textInput4", "imageInput", "videoInput", "audioInput2", "concatInput", "apiInput"].includes(targetHandle)) return "blue";
  if (["textInput2", "textInput3", "imageInput2", "imageInput3", "videoInput2", "videoInput3", "videoInput6", "audioInput3", "apiInput2", "apiInput3"].includes(targetHandle)) return "green";
  if (["videoInput4", "audioInput4", "videoInput7"].includes(targetHandle)) return "orange";
  if (["audioInput", "videoInput5", "videoInput8"].includes(targetHandle)) return "yellow";

  if (sourceNode) {
    const type = sourceNode.type;
    if (type === 'textNode' || type === 'concatNode') return "blue";
    if (type === 'imageNode') return "green";
    if (type === 'videoNode' || type === 'vidConcatNode') return "orange";
    if (type === 'audioNode') return "yellow";
  }

  return "white";
};

const SPECIAL_MODEL_NAMES = {
  "text-passthrough": "Input Text",
  "image-passthrough": "Input Image",
  "video-passthrough": "Input Video",
  "audio-passthrough": "Input Audio",
};

const formatName = (id) => id.replace(/-/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export const getModelObjStatic = (category, modelId, nodeSchemas) => {
  if (category === "api") {
    // We can't easily access filteredApiNodeModels statically without passing it,
    // but we can compute it on the fly or just return null and let useEffect handle it if needed.
    // For now, let's just use the shared logic.
    const apiModelsFromBackend = nodeSchemas?.categories?.api?.models ? Object.keys(nodeSchemas.categories.api.models) : [];
    const filtered = apiNodeModels.filter(model => apiModelsFromBackend.includes(model.id));
    return filtered.find(m => m.id === modelId) || null;
  }
  if (!modelId || !nodeSchemas?.categories) return null;
  const rawModel = nodeSchemas.categories[category]?.models?.[modelId];
  if (!rawModel) return null;

  return {
    ...rawModel,
    id: modelId,
    name: SPECIAL_MODEL_NAMES[modelId] || formatName(modelId)
  };
};

// Maps a fetched workflow-definition payload + node schemas into the shape
// NodeFlow's canvas state needs. Returns `null` when there is nothing
// restorable: no workflowData, no node-schema categories, or (the bug this
// fix targets) a workflowData object with no `.data.nodes` -- which is
// exactly the shape a FAILED fetch used to be coerced into upstream.
export const processWorkflowData = (workflowData, nodeSchemas, id) => {
  if (!workflowData || !nodeSchemas?.categories) return null;

  const workflow = workflowData?.data;
  if (!workflow?.nodes) return null;

  const restoredNodes = workflow.nodes.map(n => ({
    id: n.id,
    type: n.category === "utility"
      ? (n.model === "video-combiner" ? "vidConcatNode" : "concatNode")
      : `${n.category}Node`,
    position: {
      x: n.position?.x ?? 350,
      y: n.position?.y ?? 0
    },
    data: {
      nodeSchemas,
      modelId: n.model,
      selectedModel: getModelObjStatic(n.category, n.model, nodeSchemas),
      outputs: n.output_params?.outputs || [],
      resultUrl: n.output_params?.resultUrl || null,
      formValues: n.input_params || {},
      outputHistory: (workflowData.run_history?.[n.id] || [])
        .sort((a, b) => new Date(a.started_at) - new Date(b.started_at)),
    }
  }));

  const restoredEdges = (workflowData.edges || []).map((e) => {
    const sourceNode = restoredNodes.find(n => n.id === e.source);
    const targetNode = restoredNodes.find(n => n.id === e.target);
    let edgeColor = getEdgeColor(e.sourceHandle, e.targetHandle, sourceNode, targetNode);

    return {
      id: e.id || `${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle || null,
      targetHandle: e.targetHandle || null,
      style: edgeStyles[edgeColor],
    }
  });

  return {
    nodes: restoredNodes,
    edges: restoredEdges,
    metadata: {
      workflowId: id,
      runId: workflowData?.run_id,
      workflowName: workflowData.name,
      interactionMode: workflowData.is_owner,
      publishWorkflow: workflowData.is_published,
      template: {
        showTemplateBtn: workflowData.show_temp_button,
        isPublishedTemplate: workflowData.is_template,
      },
      category: workflowData?.category || "General"
    }
  };
};

// The restore effect's entire decision, extracted as a pure predicate: clear
// the "restoring" spinner unless processWorkflowData actually produced a
// populated state to restore. `initialState` is populated -> leave the
// spinner alone (isRestoring was initialized false in that case already).
// `initialState` is null (blank/new workflow, empty def, or a failed fetch
// coerced to an empty `{nodes:[],edges:[]}` object with no `.data`) -> clear
// it so the empty/failed canvas renders instead of spinning forever.
export const shouldClearRestoreSpinner = (initialState) => !initialState;
