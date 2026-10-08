import { useState, useEffect, useRef } from "react";
import { formatDisplayDate } from "../utils/dateFormatter";

interface TrainingJob {
  training_id: string;
  status: string;
  camera_id?: string;
  num_videos?: number;
  avg_loss?: number;
  elapsed_seconds?: number;
  created_at: string;
  error?: string;
}

const API_BASE = typeof window !== 'undefined' ? `http://${window.location.hostname}:8000` : 'http://localhost:8000';

export default function FineTuning() {
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    camera_id: "",
    learning_rate: 0.00002,
    num_epochs: 3,
    batch_size: 2,
    days: 30,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadTrainingHistory();
  }, []);

  const loadTrainingHistory = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/finetuning/history`);
      if (res.ok) {
        const data = await res.json();
        setJobs(data);
      }
    } catch (err) {
      console.error("Failed to load training history:", err);
    }
  };

  const handleStartTraining = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/v1/finetuning/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          camera_id: formData.camera_id || null,
          learning_rate: formData.learning_rate,
          num_epochs: formData.num_epochs,
          batch_size: formData.batch_size,
          days: formData.days,
        }),
      });

      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.detail || "Failed to start training");
      }

      const jobId = resData.training_id;
      setActiveJob(jobId);
      loadTrainingHistory();

      // Poll for status updates
      pollJobStatus(jobId);
    } catch (err: any) {
      setError(err.message || "Failed to start training");
    } finally {
      setIsSubmitting(false);
    }
  };

  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const pollJobStatus = async (jobId: string) => {
    for (let i = 0; i < 60; i++) {
      if (!isMountedRef.current) break;
      await new Promise((r) => setTimeout(r, 2000));
      if (!isMountedRef.current) break;

      try {
        const res = await fetch(`${API_BASE}/api/v1/finetuning/status/${jobId}`);
        if (res.ok && isMountedRef.current) {
          const statusData = await res.json();
          if (["completed", "failed"].includes(statusData.status)) {
            loadTrainingHistory();
            break;
          }
        }
      } catch (err) {
        console.error("Failed to poll status:", err);
      }
    }
  };

  return (
    <div className="mx-auto max-w-[1440px] space-y-5 pb-10 text-slate-800 dark:text-slate-100">
        {/* Header */}
        <div className="border-b border-slate-200 pb-4 dark:border-slate-700">
          <h1 className="text-xl font-semibold text-slate-800 flex items-center gap-2 dark:text-slate-100">
            <span>YOLO Model Fine-Tuning</span>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded border border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300">
              CUSTOM WEIGHT RETRAINING
            </span>
          </h1>
          <p className="text-sm text-slate-600 mt-1 dark:text-slate-300">
            Adapt spatial-temporal detection models to your city scenarios using locally extracted tracklets.
          </p>
        </div>

        {/* Start Training Form */}
        <div className="bg-white border border-slate-200 rounded p-5 shadow-sm dark:bg-slate-800 dark:border-slate-700">
          <h2 className="text-sm font-semibold text-slate-800 mb-4 dark:text-slate-100">Start new training job</h2>
          {error && (
            <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded text-xs font-semibold text-rose-700 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-300">
              {error}
            </div>
          )}

          <form onSubmit={handleStartTraining} className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-300">
                  Camera Node (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g., CAM_001"
                  value={formData.camera_id}
                  onChange={(e) =>
                    setFormData({ ...formData, camera_id: e.target.value })
                  }
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
                <p className="text-xs text-slate-500 mt-1 dark:text-slate-400">
                  Leave empty to train on all cameras
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-300">
                  Historical Data (Days)
                </label>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={formData.days}
                  onChange={(e) =>
                    setFormData({ ...formData, days: parseInt(e.target.value) })
                  }
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-300">
                  Learning Rate
                </label>
                <input
                  type="number"
                  step="0.00001"
                  value={formData.learning_rate}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      learning_rate: parseFloat(e.target.value),
                    })
                  }
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-300">
                  Epochs
                </label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={formData.num_epochs}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      num_epochs: parseInt(e.target.value),
                    })
                  }
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-300">
                  Batch Size
                </label>
                <input
                  type="number"
                  min="1"
                  max="32"
                  value={formData.batch_size}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      batch_size: parseInt(e.target.value),
                    })
                  }
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded bg-teal-700 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-teal-800 disabled:opacity-50"
            >
              {isSubmitting ? "Initiating Training Job..." : "Start Fine-Tuning Execution"}
            </button>
          </form>
        </div>

        {/* Training Jobs */}
        <div className="overflow-hidden rounded border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Training history</h2>
          </div>

          {jobs.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No retraining execution jobs recorded
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {jobs.map((job) => (
                <div
                  key={job.training_id}
                  className={`p-6 transition-colors ${
                    activeJob === job.training_id ? "bg-teal-50 border-l-2 border-teal-700 dark:bg-teal-950/20 dark:border-teal-500" : ""
                  }`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="text-xs font-mono font-semibold text-teal-700 dark:text-teal-300">
                        {job.training_id.substring(0, 8)}...
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5 dark:text-slate-400">
                        {formatDisplayDate(job.created_at)}
                      </p>
                    </div>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                        job.status === "completed"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                          : job.status === "failed"
                          ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                          : "bg-amber-500/10 text-amber-400 border-amber-500/30 animate-pulse"
                      }`}
                    >
                      {job.status.toUpperCase()}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 rounded border border-slate-200 bg-slate-50 p-3 text-xs sm:grid-cols-4 dark:border-slate-700 dark:bg-slate-900/60">
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-medium dark:text-slate-400">Target Camera</p>
                      <p className="font-medium text-slate-800 mt-0.5 dark:text-slate-100">
                        {job.camera_id || "All Nodes"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-medium dark:text-slate-400">Videos Trained</p>
                      <p className="font-medium text-slate-800 mt-0.5 dark:text-slate-100">
                        {job.num_videos || "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-medium dark:text-slate-400">Average Loss</p>
                      <p className="font-medium text-teal-700 mt-0.5 dark:text-teal-300">
                        {job.avg_loss ? job.avg_loss.toFixed(4) : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-medium dark:text-slate-400">Duration</p>
                      <p className="font-medium text-slate-800 mt-0.5 dark:text-slate-100">
                        {job.elapsed_seconds
                          ? `${(job.elapsed_seconds / 60).toFixed(1)}m`
                          : "—"}
                      </p>
                    </div>
                  </div>

                  {job.error && (
                    <div className="mt-3 rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                      Error: {job.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
    </div>
  );
}
