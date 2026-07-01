import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const vapidPublicKey = process.env.VITE_VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

webpush.setVapidDetails(
  'mailto:srikanthsajja3@gmail.com',
  vapidPublicKey,
  vapidPrivateKey
);

export default async function handler(req, res) {
  // Optional security check to ensure it's triggered by Vercel Cron or manual auth
  const cronSecret = req.headers['x-vercel-cron'];
  
  // A. Fetch all pending movements
  try {
    const { data: movements, error: movementsError } = await supabase
      .from('planned_movements')
      .select('*')
      .eq('status', 'pending');

    if (movementsError) throw movementsError;
    if (!movements || movements.length === 0) {
      return res.status(200).json({ message: 'No pending movements found.' });
    }

    // B. Fetch all push subscriptions
    const { data: subscriptions, error: subsError } = await supabase
      .from('push_subscriptions')
      .select('*');

    if (subsError) throw subsError;
    if (!subscriptions || subscriptions.length === 0) {
      return res.status(200).json({ message: 'No registered push subscriptions found.' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let notifiedCount = 0;

    for (const item of movements) {
      const dueDate = new Date(item.due_date);
      dueDate.setHours(0, 0, 0, 0);

      const diffTime = dueDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      // Check if within reminder window
      if (diffDays >= 0 && diffDays <= item.reminder_days_before) {
        // Check if already notified today
        const lastNotified = item.last_notified_at ? new Date(item.last_notified_at) : null;
        const alreadyNotifiedToday = lastNotified && lastNotified.toDateString() === today.toDateString();

        if (alreadyNotifiedToday) continue;

        const typeLabel = item.type === 'subscription' ? 'Subscription' : item.type === 'debt_taken' ? 'Return' : 'Collect';
        const notificationPayload = JSON.stringify({
          title: `FinControl: ${typeLabel} Due`,
          body: `${item.title} (₹${Number(item.amount).toLocaleString()}) is due ${diffDays === 0 ? 'today' : 'in ' + diffDays + ' day(s)'}!`,
        });

        let sendSuccess = false;

        for (const sub of subscriptions) {
          try {
            await webpush.sendNotification(sub.subscription, notificationPayload);
            sendSuccess = true;
          } catch (pushErr) {
            console.error(`Error sending push to subscription ID: ${sub.id}`, pushErr.statusCode);
            // If subscription has expired or is invalid, remove it
            if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
              await supabase
                .from('push_subscriptions')
                .delete()
                .eq('id', sub.id);
            }
          }
        }

        if (sendSuccess) {
          notifiedCount++;
          await supabase
            .from('planned_movements')
            .update({ last_notified_at: new Date().toISOString() })
            .eq('id', item.id);
        }
      }
    }

    return res.status(200).json({ message: `Cron check complete. Sent ${notifiedCount} notifications.` });
  } catch (error) {
    console.error('Error running cron check:', error);
    return res.status(500).json({ error: error.message });
  }
}
