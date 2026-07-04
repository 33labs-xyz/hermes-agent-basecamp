"use client";

import React from "react";
import { WorkflowBuilder } from "workflow-builder";
import "reactflow/dist/style.css";
import "react-toastify/dist/ReactToastify.css";


const WorkflowUI = ({ workflowId, initialNodeSchemas, initialWorkflowData }) => {
  return (
    <div className="w-full h-full bg-black">
      <WorkflowBuilder 
        workflowId={workflowId}
        initialNodeSchemas={initialNodeSchemas} 
        initialWorkflowData={initialWorkflowData}
        costType="dollars" 
      />
    </div>
  );
};

export default WorkflowUI;
