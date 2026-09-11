import LivingBrain from "@/components/LivingBrain";

export default function BrainPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Vue vivante</h1>
        <p className="page-subtitle">
          Ton infrastructure comme un organisme : chaque machine a son propre pouls, lié à sa latence réelle.
        </p>
      </div>
      <LivingBrain />
    </div>
  );
}
