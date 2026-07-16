export type ProjectOrderLifecycleAction = "relink_lift" | "hold_order" | "cancel_order";

export type ProjectOrderLifecycleMenuItem = {
  label: string;
  action: ProjectOrderLifecycleAction;
  description: string;
  tone?: "danger";
};

export const PROJECT_ORDER_LIFECYCLE_ACTIONS: ProjectOrderLifecycleMenuItem[] = [
  {
    label: "Relink Lift Order",
    action: "relink_lift",
    description: "Update the Lift order number after review.",
  },
  {
    label: "Put Order On Hold",
    action: "hold_order",
    description: "Pause the Adspace order without cancelling it.",
  },
  {
    label: "Cancel Order",
    action: "cancel_order",
    description: "Mark the Adspace order cancelled with a reason.",
    tone: "danger",
  },
];

export function buildProjectOrderActionPath(
  projectId: string,
  action: ProjectOrderLifecycleAction,
  mode: "customer" | "default" = "customer"
) {
  const params = new URLSearchParams();
  if (mode === "customer") params.set("mode", "customer");
  params.set("panel", "details");
  params.set("healthAction", action);
  return `/p/${projectId}?${params.toString()}`;
}

export function isProjectOrderLifecycleAction(value: string): value is ProjectOrderLifecycleAction {
  return value === "relink_lift" || value === "hold_order" || value === "cancel_order";
}
