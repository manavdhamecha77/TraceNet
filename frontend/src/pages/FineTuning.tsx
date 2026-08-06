import React, { useState, useEffect } from "react";
import axios from "axios";

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

export default function FineTuning() {
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [loading, setLoading] = useState(false);
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
      const response = await axios.get("/api/v1/finetuning/history");
      setJobs(response.data);
    } catch (err) {
      console.error("Failed to load training history:", err);
    }
  };

  const handleStartTraining = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await axios.post("/api/v1/finetuning/start", {
        camera_id: formData.camera_id || null,
        learning_rate: formData.learning_rate,
        num_epochs: formData.num_epochs,
        batch_size: formData.batch_size,
        days: formData.days,
      });

      const jobId = response.data.training_id;
      setActiveJob(jobId);
      loadTrainingHistory();

      // Poll for status updates
      pollJobStatus(jobId);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to start training");
    } finally {
      setIsSubmitting(false);
    }
  };

  const pollJobStatus = async (jobId: string) => {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));

      try {
        const response = await axios.get(`/api/v1/finetuning/status/${jobId}`);
        if (["completed", "failed"].includes(response.data.status)) {
          loadTrainingHistory();
          break;
        }
      } catch (err) {
        console.error("Failed to poll status:", err);
      }
    }
  };

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Model Fine-Tuning</h1>
          <p className="text-gray-600 mt-2">
            Adapt the assault detection model to your specific scenarios using local data.
          </p>
        </div>

        {/* Start Training Form */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4">Start New Training Job</h2>
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleStartTraining} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Camera (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g., CAM_001"
                  value={formData.camera_id}
                  onChange={(e) =>
                    setFormData({ ...formData, camera_id: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Leave empty to train on all cameras
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded-lg transition"
            >
              {isSubmitting ? "Starting..." : "Start Training"}
            </button>
          </form>
        </div>

        {/* Training Jobs */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-bold">Training History</h2>
          </div>

          {jobs.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              No training jobs yet
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {jobs.map((job) => (
                <div
                  key={job.training_id}
                  className={`p-6 ${
                    activeJob === job.training_id ? "bg-blue-50" : ""
                  }`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="text-sm font-mono text-gray-600">
                        {job.training_id.substring(0, 8)}...
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {new Date(job.created_at).toLocaleString()}
                      </p>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-semibold ${
                        job.status === "completed"
                          ? "bg-green-100 text-green-800"
                          : job.status === "failed"
                          ? "bg-red-100 text-red-800"
                          : "bg-yellow-100 text-yellow-800"
                      }`}
                    >
                      {job.status.toUpperCase()}
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-4">
                    <div>
                      <p className="text-xs text-gray-600">Camera</p>
                      <p className="text-sm font-semibold">
                        {job.camera_id || "All"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600">Videos Trained</p>
                      <p className="text-sm font-semibold">
                        {job.num_videos || "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600">Average Loss</p>
                      <p className="text-sm font-semibold">
                        {job.avg_loss ? job.avg_loss.toFixed(4) : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600">Duration</p>
                      <p className="text-sm font-semibold">
                        {job.elapsed_seconds
                          ? `${(job.elapsed_seconds / 60).toFixed(1)}m`
                          : "—"}
                      </p>
                    </div>
                  </div>

                  {job.error && (
                    <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
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
