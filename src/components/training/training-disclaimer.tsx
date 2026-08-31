import { Alert } from "@/components/ui/page-shell";

export function TrainingDisclaimer() {
  return (
    <Alert tone="info" data-testid="training-disclaimer">
      训练记录，非医学或智力评估。结果仅供个人练习参考，不能用于诊断或比较他人。
    </Alert>
  );
}
