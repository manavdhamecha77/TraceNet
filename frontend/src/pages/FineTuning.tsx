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
    <div className="p-6 bg-slate-950 min-h-screen text-slate-100">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="border-b border-slate-800 pb-4">
          <h1 className="text-2xl font-black text-slate-100 flex items-center gap-2">
            <span>YOLO Model Fine-Tuning</span>
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              CUSTOM WEIGHT RETRAINING
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Adapt spatial-temporal detection models to your city scenarios using locally extracted tracklets.
          </p>
        </div>

        {/* Start Training Form */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
          <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-4 font-mono">Start New Training Job</h2>
          {error && (
            <div className="mb-4 p-3 bg-rose-950/40 border border-rose-500/30 rounded-lg text-xs font-semibold text-rose-300">
              {error}
            </div>
          )}

          <form onSubmit={handleStartTraining} className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  Camera Node (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g., CAM_001"
                  value={formData.camera_id}
                  onChange={(e) =>
                    setFormData({ ...formData, camera_id: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Leave empty to train on all cameras
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
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
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
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
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
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
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
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
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-slate-950 font-bold py-2.5 px-4 rounded-lg transition-colors text-xs uppercase tracking-wider"
            >
              {isSubmitting ? "Initiating Training Job..." : "Start Fine-Tuning Execution"}
            </button>
          </form>
        </div>

        {/* Training Jobs */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-slate-800">
            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider font-mono">Training History Logs</h2>
          </div>

          {jobs.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 font-mono">
              No retraining execution jobs recorded
            </div>
          ) : (
            <div className="divide-y divide-slate-850">
              {jobs.map((job) => (
                <div
                  key={job.training_id}
                  className={`p-6 transition-colors ${
                    activeJob === job.training_id ? "bg-cyan-950/20 border-l-2 border-cyan-500" : ""
                  }`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="text-xs font-mono font-bold text-cyan-400">
                        {job.training_id.substring(0, 8)}...
                      </p>
                      <p className="text-[10px] text-slate-500 mt-0.5 font-mono">
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

                  <div className="grid grid-cols-4 gap-4 bg-slate-950/60 p-3 rounded-lg border border-slate-800 text-xs">
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-mono">Target Camera</p>
                      <p className="font-semibold text-slate-200 mt-0.5">
                        {job.camera_id || "All Nodes"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-mono">Videos Trained</p>
                      <p className="font-semibold text-slate-200 mt-0.5">
                        {job.num_videos || "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-mono">Average Loss</p>
                      <p className="font-semibold text-cyan-400 mt-0.5">
                        {job.avg_loss ? job.avg_loss.toFixed(4) : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-mono">Duration</p>
                      <p className="font-semibold text-slate-200 mt-0.5">
                        {job.elapsed_seconds
                          ? `${(job.elapsed_seconds / 60).toFixed(1)}m`
                          : "—"}
                      </p>
                    </div>
                  </div>

                  {job.error && (
                    <div className="mt-3 p-3 bg-rose-950/40 border border-rose-500/30 rounded-lg text-xs text-rose-300 font-mono">
                      Error: {job.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
