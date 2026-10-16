import React from 'react';

export interface StepItem {
  id: string;
  label: string;
  description?: string;
}

interface WorkflowStepperProps {
  steps: StepItem[];
  currentStepIndex: number;
  onStepClick?: (index: number) => void;
  className?: string;
}

export default function WorkflowStepper({
  steps,
  currentStepIndex,
  onStepClick,
  className = '',
}: WorkflowStepperProps) {
  return (
    <div
      className={`bg-white border border-[#CBD2D7] rounded-xl p-5 md:px-8 md:py-6 ${className}`}
      role="region"
      aria-label="Workflow progress"
    >
      <div className="relative flex items-center justify-between">
        {/* Connecting horizontal line */}
        <div className="absolute left-6 right-6 top-7 h-[2px] bg-[#E2E7EC] -translate-y-1/2 z-0" />

        {steps.map((step, idx) => {
          const isCompleted = idx < currentStepIndex;
          const isCurrent = idx === currentStepIndex;
          const isUpcoming = idx > currentStepIndex;

          return (
            <div
              key={step.id}
              className="relative z-10 flex flex-col items-center flex-1 cursor-default select-none"
              onClick={() => onStepClick && isCompleted && onStepClick(idx)}
            >
              {/* Step Label (top) */}
              <span
                className={`text-[13px] md:text-sm mb-2 text-center transition-colors ${
                  isCurrent
                    ? 'font-semibold text-[#0B1320]'
                    : isCompleted
                    ? 'font-medium text-[#0B1320]'
                    : 'font-normal text-[#80909D]'
                }`}
              >
                {step.label}
              </span>

              {/* Circular Marker */}
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center transition-all bg-white ${
                  isCurrent
                    ? 'border-2 border-[#B4E39C] ring-4 ring-[#E6F4DD]'
                    : isCompleted
                    ? 'border-2 border-[#B4E39C] bg-[#E6F4DD]'
                    : 'border-2 border-[#CFD6DC]'
                }`}
              >
                {isCurrent && (
                  <div className="w-2 h-2 rounded-full bg-[#2E6819]" />
                )}
                {isCompleted && (
                  <div className="w-2 h-2 rounded-full bg-[#2E6819]" />
                )}
                {isUpcoming && (
                  <div className="w-1.5 h-1.5 rounded-full bg-[#CBD2D7]" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
